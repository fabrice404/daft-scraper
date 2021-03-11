## Daft scraper
This project can extract metadata for all houses in sale on Daft website for a given list of cities.

### Usage
You will need an API key from [openrouteservice.org](https://openrouteservice.org/). Once you get the key, copy the `.env.example` file to `.env` and put your key in `OPENROUTESERVICE_API_KEY` parameter.

\
Set the list of cities you're interested in in the file `cities.json` with format `city-county` from Daft website  \
e.g. `malahide-dublin`

\
Set the list of public transport stations in `transports.json`, it contains the DART stations and Luas Green line stations by default.
