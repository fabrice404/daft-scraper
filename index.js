require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const { argv } = require('process');

/// ////////////////////////////////////////////
// CONSTANTS

// folders
const CACHE_FOLDER = process.env.CACHE_FOLDER || `${__dirname}/cache`;
const OUTPUT_FOLDER = process.env.OUTPUT_FOLDER || `${os.homedir()}/files`;

// openrouteservice
const { OPENROUTESERVICE_API_KEY } = process.env;
const OPENROUTESERVICE_RPM_LIMIT = 40;

// filter
const MINUMUM_PRICE = parseInt(process.env.MINUMUM_PRICE, 10);
const MAXIMUM_PRICE = parseInt(process.env.MAXIMUM_PRICE, 10);
const MINUMUM_BED = parseInt(process.env.MINUMUM_BED || '1', 10);
const MINUMUM_BATH = parseInt(process.env.MINUMUM_BATH || '1', 10);

/// ////////////////////////////////////////////
// CONFIG FILES
const stores = JSON.parse(fs.readFileSync(`${__dirname}/stores.json`));
const transports = JSON.parse(fs.readFileSync(`${__dirname}/transports.json`));

/**
 * Pauses the execution for a given duration
 * @param {number} ms duration in miliseconds
 * @returns
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gets daft.ie page for given city and page number
 * @param {string} city City slug
 * @param {number} page Optional page number
 * @returns
 */
const getDaftLocation = async (city, page = 1) => {
  console.log(city, page);
  const parameters = [
    `salePrice_from=${MINUMUM_PRICE}`,
    `salePrice_to=${MAXIMUM_PRICE}`,
    `numBeds_from=${MINUMUM_BED}`,
    `numBaths_from=${MINUMUM_BATH}`,
    'sort=publishDateDesc',
    'pageSize=20',
    `from=${(page - 1) * 20}`,
  ];
  const url = `https://www.daft.ie/property-for-sale/${city}?${parameters.join('&')}`;
  const properties = [];
  const response = await axios.get(url);
  const html = response.data;
  const json = JSON.parse(
    html
      .split('<script id="__NEXT_DATA__" type="application/json">')[1]
      .split('</script>')[0],
  );

  properties.push(...json.props.pageProps.listings.map((l) => l.listing));

  if (json.props.pageProps.listings.length === 20) {
    const listings = await getDaftLocation(city, page + 1);
    properties.push(...listings);
  }

  if (page === 1) {
    fs.writeFileSync(`${CACHE_FOLDER}/${city}.json`, JSON.stringify({ properties }, null, 2));
  }

  return properties;
};

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
  return Math.round(dist * 10) / 10;
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
  const file = `${CACHE_FOLDER}/transport/${id}.json`;
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file));
  }

  const station = [...transports]
    .map((transport) => ({
      ...transport,
      distance: calculateDistance(lat, lng, transport.lat, transport.lng),
    }))
    .sort((a, b) => a.distance - b.distance)
    .shift();

  let transportType = '';
  if (station.type === 'Commuter' && station.distance < 10) {
    transportType = 'driving-car';
  } else if (station.distance < 2) {
    transportType = 'foot-walking';
  } else {
    return null;
  }

  const url = `https://api.openrouteservice.org/v2/directions/${transportType}?api_key=${OPENROUTESERVICE_API_KEY}&start=${lng},${lat}&end=${station.lng},${station.lat}`;
  const response = await axios.get(url);
  const { distance, duration } = response.data.features[0].properties.summary;
  station.distance = Math.round(distance / 100) / 10;
  station.duration = Math.round(duration / 60);
  await sleep(60000 / OPENROUTESERVICE_RPM_LIMIT);
  fs.writeFileSync(file, JSON.stringify(station, null, 2));

  console.log(`${id}: ${station.name} (${station.type}), ${station.distance} km, ${station.duration} min`);
  return station;
};

/**
 * Calculates distance between given GPS location and stores
 * @param {string} id Property identifier to store in cache
 * @param {number} lat
 * @param {number} lng
 * @returns
 */
const findClosestStore = async (id, lat, lng) => {
  const file = `${CACHE_FOLDER}/store/${id}.json`;
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file));
  }

  const store = [...stores]
    .map((transport) => ({
      ...transport,
      distance: calculateDistance(lat, lng, transport.lat, transport.lng),
    }))
    .sort((a, b) => a.distance - b.distance)
    .shift();

  const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${OPENROUTESERVICE_API_KEY}&start=${lng},${lat}&end=${store.lng},${store.lat}`;
  const response = await axios.get(url);
  const { distance, duration } = response.data.features[0].properties.summary;
  store.distance = Math.round(distance / 100) / 10;
  store.duration = Math.round(duration / 60);
  await sleep(60000 / OPENROUTESERVICE_RPM_LIMIT);
  fs.writeFileSync(file, JSON.stringify(store, null, 2));

  console.log(`${id}: ${store.name}, ${store.distance} km, ${store.duration} min`);
  return store;
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
    case 'A': scoring.ber = 200; break;
    case 'B': scoring.ber = 70; break;
    case 'C': scoring.ber = 0; break;
    case 'D': scoring.ber = -50; break;
    case 'E': scoring.ber = -100; break;
    case 'F': scoring.ber = -150; break;
    case 'G': scoring.ber = -200; break;
    default: break;
  }
  switch (property.ber.rating[1]) {
    case '1': scoring.ber += 0.2 * Math.abs(scoring.ber); break;
    case '2': scoring.ber += 0.1 * Math.abs(scoring.ber); break;
    case '3': scoring.ber += 0.05 * Math.abs(scoring.ber); break;
    default: break;
  }
  scoring.ber = Math.round(scoring.ber);

  const bedrooms = property.numBedrooms ? property.numBedrooms.replace(/[^0-9]/gi, '') : 0;
  const bathrooms = property.numBathrooms ? property.numBathrooms.replace(/[^0-9]/gi, '') : 0;
  const pricePerSquareMeter = Math.ceil(price / property.floorArea.value);
  const floorArea = parseInt(property.floorArea.value, 10);
  if (floorArea > 400 || floorArea < 100) {
    return null;
  }

  const [lng, lat] = property.point.coordinates;
  const distance = distanceFromOConnellBridge(lat, lng);
  const transport = await findClosestTransport(property.id, lat, lng);
  if (transport == null) {
    return null;
  }
  const store = await findClosestStore(property.id, lat, lng);
  const middlePrice = MAXIMUM_PRICE - ((MAXIMUM_PRICE - MINUMUM_PRICE) / 2);

  scoring.bedrooms = bedrooms * 25; // 1 bedroom = 25 pts;
  scoring.bathrooms = bathrooms * 10; // 1 bathroom = 10 pts
  scoring.floorArea = (floorArea - 150) * 2;
  scoring.distance = -Math.round(distance / 10);
  scoring.transport = -Math.round(transport.duration * 3);
  scoring.store = -Math.round(store.duration * 2);
  scoring.price = Math.round((middlePrice - price) / 1000);
  scoring.pricePerSquareMeter = Math.round((5000 - pricePerSquareMeter) / 100);

  scoring.type = 0;
  switch (property.propertyType) {
    case 'Detached': scoring.type = 100; break;
    case 'Semi-D': scoring.type = 50; break;
    case 'Bungalow': scoring.type = 30; break;
    default: scoring.type = -100; break;
  }

  /* eslint-disable no-param-reassign */
  scoring.total = Object.keys(scoring).reduce((acc, val) => {
    acc += scoring[val];
    return acc;
  }, 0);
  /* eslint-enable no-param-reassign */

  const {
    id, title, propertyType, point, seoFriendlyPath, abbreviatedPrice, publishDate,
  } = property;
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
    store,
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

  if (!argv.includes('skip')) {
    await getDaftLocation('ireland');
  }

  const ids = [];
  const properties = fs.readdirSync(`${CACHE_FOLDER}/`)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(`${CACHE_FOLDER}/${f}`, 'utf-8')).properties)
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
      result.push(p);
    }
  }

  console.log(`${result.length} properties listed`);
  fs.writeFileSync(`${OUTPUT_FOLDER}/daft.json`, JSON.stringify(result, null, 2));
};

main();
