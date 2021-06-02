## Daft scraper
This project can extract metadata for all houses in sale on Daft website in Ireland.

### Usage
You will need an API key from [openrouteservice.org](https://openrouteservice.org/). Once you get the key, copy the `.env.example` file to `.env` and put your key in `OPENROUTESERVICE_API_KEY` parameter.

\
run `npm start` to run start the extraction, it will create the json file in `~/files/daft.json`
