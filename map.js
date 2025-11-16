import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

mapboxgl.accessToken =
  'pk.eyJ1IjoiYW5keWtraW1tIiwiYSI6ImNtaTB4cnJsODBzejYybHE1aGFhOTQ5ejYifQ.zbaCSX8kgZAYdcZefkODCQ';

// -----------------------------
// Initialize the map
// -----------------------------
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // basemap style
  center: [-71.09415, 42.36027], // [lon, lat]
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

console.log('Mapbox GL JS Loaded:', mapboxgl);

// SVG overlay inside the map container
const svg = d3.select('#map').select('svg');

// Helper: convert a station's lon/lat into pixel coordinates on the map
function getCoords(station) {
  // Use whatever property names your stations JSON has for lon/lat
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point); // project to pixels
  return { cx: x, cy: y };
}

map.on('load', async () => {
  // -----------------------------
  // Boston bike lanes
  // -----------------------------
  map.addSource('boston_route', {
    type: 'geojson',
    data:
      'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });

  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  // -----------------------------
  // Cambridge bike lanes
  // -----------------------------
  map.addSource('cambridge_route', {
    type: 'geojson',
    data:
      'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#00AAFF',
      'line-width': 3,
      'line-opacity': 0.6
    }
  });

  // -----------------------------
  // Load station JSON + traffic CSV
  // -----------------------------
  const STATIONS_URL =
    'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  const TRAFFIC_URL =
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

  try {
    // Load both datasets in parallel
    const [stationsJson, trips] = await Promise.all([
      d3.json(STATIONS_URL),
      d3.csv(TRAFFIC_URL, d3.autoType)
    ]);

    console.log('Loaded JSON Data:', stationsJson);
    console.log('Loaded trips (first 5):', trips.slice(0, 5));

    let stations = stationsJson.data.stations;
    console.log('Stations Array:', stations);

    // -----------------------------
    // Step 4.2: arrivals, departures, totalTraffic
    // -----------------------------

    // departures: count of trips grouped by start_station_id
    const departures = d3.rollup(
      trips,
      v => v.length,
      d => d.start_station_id
    );

    // arrivals: count of trips grouped by end_station_id
    const arrivals = d3.rollup(
      trips,
      v => v.length,
      d => d.end_station_id
    );

    // Add arrivals, departures, totalTraffic to each station
    stations = stations.map(station => {
      // Adjust this if your station ID field is different, e.g. station.short_name
      const id = station.short_name;

      station.arrivals = arrivals.get(id) ?? 0;
      station.departures = departures.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;

      return station;
    });

    console.log(
      'Stations with traffic example:',
      stations.slice(0, 5).map(d => ({
        id: d.Number,
        arrivals: d.arrivals,
        departures: d.departures,
        totalTraffic: d.totalTraffic
      }))
    );

    // -----------------------------
    // Step 4.3: radius scale based on totalTraffic
    // -----------------------------
    const maxTraffic = d3.max(stations, d => d.totalTraffic);

    const radiusScale = d3
      .scaleSqrt()
      .domain([0, maxTraffic])
      .range([0, 25]); // min/max circle radius in pixels

    // Create circles for stations
    const circles = svg
    .selectAll('circle')
    .data(stations)
    .enter()
    .append('circle')
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.6)
    .attr('r', d => radiusScale(d.totalTraffic))
    .each(function (d) {
    // Add <title> for browser tooltips
    d3.select(this)
      .append('title')
      .text(
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
      );
  });


    // -----------------------------
    // Position circles + keep them in sync with map
    // -----------------------------
    function updatePositions() {
      circles
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy);
    }

    // Initial position update when map loads
    updatePositions();

    // Reposition markers on map interactions
    map.on('move', updatePositions);   // during map movement
    map.on('zoom', updatePositions);   // during zoom
    map.on('resize', updatePositions); // on window resize
    map.on('moveend', updatePositions);
  } catch (error) {
    console.error('Error loading data:', error);
  }
});
