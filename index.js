require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const os = require('os');

///////////////////////////////////////////////
// CONSTANTS

// folders
const CACHE_FOLDER = process.env.CACHE_FOLDER || `${__dirname}/cache`;
const OUTPUT_FOLDER = process.env.OUTPUT_FOLDER || `${os.homedir()}/files`;

// openrouteservice 
const OPENROUTESERVICE_API_KEY = process.env.OPENROUTESERVICE_API_KEY;
const OPENROUTESERVICE_RPM_LIMIT = 40;

// price range filter
const MINUMUM_PRICE = parseInt(process.env.MINUMUM_PRICE, 10);
const MAXIMUM_PRICE = parseInt(process.env.MAXIMUM_PRICE, 10);

///////////////////////////////////////////////
// CONFIG FILES
const cities = JSON.parse(fs.readFileSync(`${__dirname}/cities.json`));
const transports = JSON.parse(fs.readFileSync(`${__dirname}/transports.json`));

/**
 * Pauses the execution for a given duration
 * @param {number} ms duration in miliseconds
 * @returns 
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Gets daft.ie page for given city and page number
 * @param {string} city City slug
 * @param {number} page Optional page number
 * @returns 
 */
const getDaftLocation = async (city, page = 1) => {
  console.log(city, page);
  const properties = [];
  const url = `https://www.daft.ie/property-for-sale/${city}/houses?sort=publishDateDesc&from=${(page - 1) * 20}`
  const response = await axios.get(url);
  const html = response.data;
  const json = JSON.parse(
    html
      .split('<script id="__NEXT_DATA__" type="application/json">')[1]
      .split('</script>')[0]
  );

  properties.push(...json.props.pageProps.listings.map(l => l.listing));

  if (json.props.pageProps.listings.length === 20) {
    const listings = await getDaftLocation(city, page + 1);
    properties.push(...listings);
  }

  if (page === 1) {
    fs.writeFileSync(`${CACHE_FOLDER}/${city}.json`, JSON.stringify({ properties }, null, 2));
  }

  return properties;
}

/**
 * Calculates a distance between two GPS locations
 * @param {number} lat1 
 * @param {number} lng1 
 * @param {number} lat2 
 * @param {number} lng2 
 * @returns 
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const radlat1 = (Math.PI * lat1) / 180;
  const radlat2 = (Math.PI * lat2) / 180;
  const theta = lng1 - lng2;
  const radtheta = (Math.PI * theta) / 180;
  let dist = Math.sin(radlat1) * Math.sin(radlat2)
    + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
  if (dist > 1) {
    dist = 1;
  }
  dist = Math.acos(dist);
  dist = (dist * 180) / Math.PI;
  dist = dist * 60 * 1.1515 * 1.609344;
  return dist;
};

/**
 * Calculates distance between given GPS location and O'Connell bridge
 * @param {number} lat 
 * @param {number} lng 
 * @returns 
 */
const distanceFromOConnellBridge = (lat, lng) => calculateDistance(
  lat, lng,
  53.347256812999525, -6.259080753374189,
);

/**
 * Calculates distance between given GPS location and public transports stations
 * @param {string} id Property identifier to store in cache
 * @param {number} lat 
 * @param {number} lng 
 * @returns 
 */
const findClosestTransport = async (id, lat, lng) => {
  const file = `${CACHE_FOLDER}/transport-${id}.json`;
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file));
  }
  console.log(`No cache found for property ${id}, calculating closest transport`);

  // calculate distance as the crow flies for each station
  const stations = [...transports]
    .map((transport) => ({
      ...transport,
      distance: calculateDistance(lat, lng, transport.lat, transport.lng),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  // calculate walking distsance for the 3 closest stations
  for (const station of stations) {
    const url = `https://api.openrouteservice.org/v2/directions/foot-walking?api_key=${OPENROUTESERVICE_API_KEY}&start=${lng},${lat}&end=${station.lng},${station.lat}`;
    const response = await axios.get(url);
    const { distance, duration } = response.data.features[0].properties.summary
    station.distance = distance;
    station.duration = duration;
    await sleep(60000 / OPENROUTESERVICE_RPM_LIMIT);
  }
  const result = stations.sort((a, b) => a.distance - b.distance)[0];
  console.log(`Closest transport for ${id}: ${result.name} (${result.type})`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  return result;
};

/**
 * Filter, extract and score metadata from daft property object
 * @param {object} property 
 * @returns 
 */
const extractPropertyData = async (property) => {
  const price = property.price.replace(/[^0-9]/gi, '');
  if (
    // expluce propreties with no properly defined floor area
    !property.floorArea || !property.floorArea.value || property.floorArea.unit !== 'METRES_SQUARED'

    // exclude properties with no BER rating
    || !property.ber || !property.ber.rating.match(/[A-G]{1}[0-9]/)

    // exluce properties with no price or outside of price range
    || price === '' || price < MINUMUM_PRICE || price > MAXIMUM_PRICE

    // exclude properties without images
    || !property.media || !property.media.images || property.media.images.length === 0

    // exluce properties without location
    || !property.point || !property.point.coordinates
  ) {
    return null;
  }

  const scoring = {};
  scoring.ber = 0;
  switch (property.ber.rating[0]) {
    case 'A': scoring.ber += 100; break;
    case 'B': scoring.ber += 70; break;
    case 'C': scoring.ber += 20; break;
    case 'D': scoring.ber += 0; break;
    default: return null;
  }
  switch (property.ber.rating[1]) {
    case '1': scoring.ber += 20; break;
    case '2': scoring.ber += 10; break;
    case '3': scoring.ber += 5; break;
    default: scoring.ber += 0; break;
  }

  const bedrooms = property.numBedrooms ? property.numBedrooms.replace(/[^0-9]/gi, '') : 0;
  const bathrooms = property.numBathrooms ? property.numBathrooms.replace(/[^0-9]/gi, '') : 0;
  const pricePerSquareMeter = Math.ceil(price / property.floorArea.value);
  const [lng, lat] = property.point.coordinates;
  const distance = distanceFromOConnellBridge(lat, lng);
  const transport = await findClosestTransport(property.id, lat, lng);
  const transportDurationMin = Math.round(transport.duration / 60);
  const floorArea = parseInt(property.floorArea.value, 10);

  scoring.bedrooms = bedrooms * 25; // 1 bedroom = 25 pts;
  scoring.bathrooms = bathrooms * 10; // 1 bathroom = 10 pts
  scoring.floorArea = floorArea;
  scoring.distance = -Math.round((distance * distance) / 10);
  scoring.transport = -Math.round(transportDurationMin * 2);
  scoring.price = Math.round((700000 - price) / 2000);
  scoring.pricePerSquareMeter = Math.round((5000 - pricePerSquareMeter) / 100);

  scoring.type = 0;
  switch (property.propertyType) {
    case 'Detached': scoring.type = 100; break;
    case 'Semi-D': scoring.type = 50; break;
    case 'Bungalow': scoring.type = 30; break;
    case 'End of Terrace': scoring.type = 20; break;
    case 'Terrace': scoring.type = -100; break;
    default: break;
  }

  /* eslint-disable no-param-reassign */
  scoring.total = Object.keys(scoring).reduce((acc, val) => {
    acc += scoring[val];
    return acc;
  }, 0);
  /* eslint-enable no-param-reassign */

  const { id, title, propertyType, point, seoFriendlyPath, abbreviatedPrice, publishDate } = property;
  const image = property.media.images[0].size300x200;
  const ber = property.ber.rating;
  return {
    id,
    title,
    propertyType,
    image,
    floorArea,
    point,
    seoFriendlyPath,
    abbreviatedPrice,
    publishDate,
    ber,
    lat,
    lng,
    price,
    bedrooms,
    bathrooms,
    pricePerSquareMeter,
    distance,
    transport,
    scoring,
  };
};

/**
 * Main function
 */
const main = async () => {
  // create cache & output folders
  if (!fs.existsSync(CACHE_FOLDER)) { fs.mkdirSync(CACHE_FOLDER, { recursive: true }); }
  if (!fs.existsSync(OUTPUT_FOLDER)) { fs.mkdirSync(OUTPUT_FOLDER, { recursive: true }); }

  for (const city of cities) {
    await getDaftLocation(city);
  }

  const ids = [];
  const properties = fs.readdirSync(`${CACHE_FOLDER}/`)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(`${CACHE_FOLDER}/${f}`, 'utf-8')).properties)
    .flat()
    .filter((property) => {
      if (property) {
        const { id } = property;
        if (!ids.includes(id)) {
          ids.push(id);
          return true;
        }
      }
      return false;
    });

  const result = [];
  for (const property of properties) {
    const p = await extractPropertyData(property);
    if (p) {
      result.push(p)
    }
  };

  console.log(`${result.length} properties listed`);
  fs.writeFileSync(`${OUTPUT_FOLDER}/daft.json`, JSON.stringify(result, null, 2));
};

main();