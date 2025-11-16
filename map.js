import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

mapboxgl.accessToken =
  'pk.eyJ1IjoiYW5keWtraW1tIiwiYSI6ImNtaTB4cnJsODBzejYybHE1aGFhOTQ5ejYifQ.zbaCSX8kgZAYdcZefkODCQ';

// -----------------------------
// Global helpers for time + traffic
// -----------------------------

let timeFilter = -1; // -1 = no filter

// Convert minutes since midnight to "HH:MM AM/PM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Compute arrivals, departures, totalTraffic for each station
function computeStationTraffic(stations, trips) {
  // Compute departures
  const departures = d3.rollup(
    trips,
    v => v.length,
    d => d.start_station_id
  );

  // Compute arrivals
  const arrivals = d3.rollup(
    trips,
    v => v.length,
    d => d.end_station_id
  );

  // Update each station
  return stations.map(station => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Minutes since midnight from a Date object
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Filter trips to those starting or ending within 60 minutes of timeFilter
function filterTripsByTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter(trip => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

// -----------------------------
// Initialize the map
// -----------------------------
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

console.log('Mapbox GL JS Loaded:', mapboxgl);

// SVG overlay inside the map container
const svg = d3.select('#map').select('svg');

// Helper: convert a station's lon/lat into pixel coordinates on the map
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
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
    const [stationsJson, trips] = await Promise.all([
      d3.json(STATIONS_URL),
      d3.csv(TRAFFIC_URL, trip => {
        // parse started_at and ended_at as Dates
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      })
    ]);

    console.log('Loaded JSON Data:', stationsJson);
    console.log('Loaded trips (first 5):', trips.slice(0, 5));

    // Compute initial station traffic with all trips
    const stations = computeStationTraffic(stationsJson.data.stations, trips);

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
    // Radius scale based on totalTraffic (all trips)
    // -----------------------------
    const maxTraffic = d3.max(stations, d => d.totalTraffic);

    const radiusScale = d3
      .scaleSqrt()
      .domain([0, maxTraffic])
      .range([0, 25]); // default range; will change when filtering

    // -----------------------------
    // Create circles for stations (with key function)
    // -----------------------------
    const circles = svg
      .selectAll('circle')
      .data(stations, d => d.short_name) // key by station ID
      .enter()
      .append('circle')
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.6)
      .attr('r', d => radiusScale(d.totalTraffic))
      .each(function (d) {
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

    updatePositions();

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // -----------------------------
    // Step 5.2: slider reactivity
    // -----------------------------
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    // Update scatterplot based on selected time
    function updateScatterPlot(timeFilter) {
      // Filter trips by time
      const filteredTrips = filterTripsByTime(trips, timeFilter);

      // Recompute station traffic using filtered trips
      const filteredStations = computeStationTraffic(stations, filteredTrips);

      // Adjust radius range depending on whether filtering is applied
      timeFilter === -1
        ? radiusScale.range([0, 25])
        : radiusScale.range([3, 50]);

      // Update circles' radii (reuse existing elements, keyed by short_name)
      circles
        .data(filteredStations, d => d.short_name)
        .join('circle')
        .attr('r', d => radiusScale(d.totalTraffic));
    }

    function updateTimeDisplay() {
      timeFilter = Number(timeSlider.value); // Get slider value

      if (timeFilter === -1) {
        selectedTime.textContent = ''; // Clear time display
        anyTimeLabel.style.display = 'block'; // Show "(any time)"
      } else {
        selectedTime.textContent = formatTime(timeFilter); // Display formatted time
        anyTimeLabel.style.display = 'none'; // Hide "(any time)"
      }

      // Update the map visualization based on selected time
      updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay(); // initialize UI + circles

  } catch (error) {
    console.error('Error loading data:', error);
  }
});
