'use client';

import 'leaflet/dist/leaflet.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, Layers3, LocateFixed, MapPin, Minus, Plus, Search, X } from 'lucide-react';
import type {
  CircleMarker as LeafletCircleMarker,
  Map as LeafletMap,
  Marker as LeafletMarker,
  TileLayer as LeafletTileLayer,
} from 'leaflet';
import styles from './MapApp.module.css';

const INITIAL_CENTER: [number, number] = [41.2257, 1.7249];
const MIN_ZOOM = 2;
const MAX_ZOOM = 20;

const OSM_CREDIT = {
  label: '© OpenStreetMap',
  url: 'https://www.openstreetmap.org/copyright',
};
const CARTO_CREDIT = { label: '© CARTO', url: 'https://carto.com/attributions' };

type MapCredit = {
  label: string;
  url: string;
};

type MapStyleDefinition = {
  label: string;
  url: string;
  credits: readonly MapCredit[];
  subdomains?: string;
  maxNativeZoom?: number;
  filter?: string;
};

const MAP_STYLES = {
  streets: {
    label: 'Street atlas',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    credits: [OSM_CREDIT],
    maxNativeZoom: 19,
  },
  voyager: {
    label: 'Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    credits: [OSM_CREDIT, CARTO_CREDIT],
    subdomains: 'abcd',
  },
  terrain: {
    label: 'Topographic',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    credits: [OSM_CREDIT, { label: '© OpenTopoMap', url: 'https://opentopomap.org' }],
    subdomains: 'abc',
    maxNativeZoom: 17,
  },
  humanitarian: {
    label: 'Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    credits: [OSM_CREDIT, { label: '© HOT', url: 'https://www.hotosm.org' }],
    subdomains: 'abc',
    maxNativeZoom: 19,
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credits: [
      {
        label: 'Imagery © Esri & providers',
        url: 'https://www.esri.com/en-us/legal/terms/data-attributions',
      },
    ],
    maxNativeZoom: 19,
  },
  midnight: {
    label: 'Midnight blue',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    credits: [OSM_CREDIT, CARTO_CREDIT],
    subdomains: 'abcd',
    filter: 'sepia(1) saturate(4.2) hue-rotate(158deg) brightness(.78) contrast(1.14)',
  },
  ultraviolet: {
    label: 'Ultraviolet',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    credits: [OSM_CREDIT, CARTO_CREDIT],
    subdomains: 'abcd',
    filter: 'sepia(1) saturate(5.2) hue-rotate(226deg) brightness(.8) contrast(1.18)',
  },
} as const satisfies Record<string, MapStyleDefinition>;

type MapStyleId = keyof typeof MAP_STYLES;

type SearchResult = {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  type: string;
};

export default function MapApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileLayerRef = useRef<LeafletTileLayer | null>(null);
  const pendingLayerRef = useRef<LeafletTileLayer | null>(null);
  const pinRef = useRef<LeafletMarker | null>(null);
  const locationRef = useRef<LeafletCircleMarker | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const styleRequestRef = useRef(0);
  const activeStyleRef = useRef<MapStyleId>('streets');
  const [mapStyle, setMapStyle] = useState<MapStyleId>('streets');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [changingStyle, setChangingStyle] = useState(false);
  const [zoom, setZoom] = useState(13);
  const [status, setStatus] = useState('Starting map');
  const [coordinates, setCoordinates] = useState<[number, number]>(INITIAL_CENTER);

  const installTileStyle = useCallback((styleId: MapStyleId, initial = false) => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    const config: MapStyleDefinition = MAP_STYLES[styleId];
    const previousLayer = tileLayerRef.current;
    const requestId = ++styleRequestRef.current;
    let loadedTile = false;
    let settled = false;

    pendingLayerRef.current?.remove();
    pendingLayerRef.current = null;
    if (!initial) setChangingStyle(true);
    setStatus(`Loading ${config.label}`);

    const layer = L.tileLayer(config.url, {
      subdomains: config.subdomains ?? 'abc',
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxNativeZoom: config.maxNativeZoom ?? MAX_ZOOM,
      keepBuffer: 4,
      updateWhenZooming: false,
      updateWhenIdle: false,
      opacity: initial ? 1 : 0,
    });

    const fail = () => {
      if (settled || requestId !== styleRequestRef.current) return;
      settled = true;
      layer.remove();
      pendingLayerRef.current = null;
      setMapStyle(activeStyleRef.current);
      setChangingStyle(false);
      setStatus(`${config.label} is unavailable`);
    };

    const loadTimeout = window.setTimeout(() => {
      if (!loadedTile) fail();
    }, 9000);

    layer.on('tileload', (event) => {
      loadedTile = true;
      const tile = event.tile as HTMLImageElement;
      tile.style.filter = config.filter ?? 'none';
    });
    layer.on('load', () => {
      if (settled || requestId !== styleRequestRef.current) return;
      if (!loadedTile) {
        fail();
        return;
      }
      settled = true;
      window.clearTimeout(loadTimeout);
      layer.setOpacity(1);
      if (previousLayer && previousLayer !== layer) previousLayer.remove();
      tileLayerRef.current = layer;
      pendingLayerRef.current = null;
      activeStyleRef.current = styleId;
      setChangingStyle(false);
      setStatus(`${config.label} online`);
    });
    layer.on('tileerror', () => {
      if (!loadedTile && requestId === styleRequestRef.current) {
        setStatus(`Retrying ${config.label}`);
      }
    });

    layer.addTo(map);
    if (initial) tileLayerRef.current = layer;
    else pendingLayerRef.current = layer;
  }, []);

  const placePin = useCallback((latitude: number, longitude: number, label?: string) => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    pinRef.current?.remove();
    const icon = L.divIcon({
      className: styles.pinIcon,
      html: '<span></span>',
      iconSize: [24, 30],
      iconAnchor: [12, 28],
      popupAnchor: [0, -27],
    });
    const marker = L.marker([latitude, longitude], { icon }).addTo(map);
    if (label) marker.bindPopup(label, { closeButton: false }).openPopup();
    pinRef.current = marker;
    setCoordinates([latitude, longitude]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame = 0;

    void import('leaflet').then((module) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = module.default;
      leafletRef.current = L;

      const map = L.map(containerRef.current, {
        center: INITIAL_CENTER,
        zoom: 13,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        zoomControl: false,
        attributionControl: false,
        worldCopyJump: true,
        zoomAnimation: true,
        fadeAnimation: true,
        wheelPxPerZoomLevel: 90,
      });
      mapRef.current = map;
      installTileStyle('streets', true);

      map.on('click', (event) => {
        placePin(event.latlng.lat, event.latlng.lng);
        setStatus('Pin placed');
      });
      map.on('zoomend', () => setZoom(map.getZoom()));

      resizeObserver = new ResizeObserver(() => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          map.invalidateSize({ animate: false, pan: false });
        });
      });
      resizeObserver.observe(containerRef.current);
      resizeFrame = window.requestAnimationFrame(() => {
        map.invalidateSize({ animate: false, pan: false });
      });
    });

    return () => {
      cancelled = true;
      styleRequestRef.current += 1;
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      pendingLayerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      pendingLayerRef.current = null;
      pinRef.current = null;
      locationRef.current = null;
      leafletRef.current = null;
    };
  }, [installTileStyle, placePin]);

  const changeStyle = (nextStyle: MapStyleId) => {
    if (nextStyle === mapStyle || changingStyle) return;
    setMapStyle(nextStyle);
    installTileStyle(nextStyle);
  };

  const searchPlaces = async (event: React.FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2 || searching) return;
    setSearching(true);
    setResults([]);
    setStatus('Searching places');

    try {
      const response = await fetch(`/api/maps/search?q=${encodeURIComponent(term)}`);
      const payload = (await response.json()) as { results?: SearchResult[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Search failed');
      const nextResults = payload.results ?? [];
      setResults(nextResults);
      setStatus(nextResults.length ? `${nextResults.length} places found` : 'No places found');
    } catch {
      setStatus('Search unavailable');
    } finally {
      setSearching(false);
    }
  };

  const selectResult = (result: SearchResult) => {
    const map = mapRef.current;
    map?.stop();
    map?.flyTo([result.latitude, result.longitude], 14, { duration: 0.7 });
    placePin(result.latitude, result.longitude, result.name);
    setQuery(result.name);
    setResults([]);
    setStatus(result.name);
  };

  const locateUser = () => {
    if (!navigator.geolocation) {
      setStatus('Location is not supported');
      return;
    }

    setLocating(true);
    setStatus('Finding your location');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const map = mapRef.current;
        const L = leafletRef.current;
        if (!map || !L) {
          setLocating(false);
          return;
        }
        locationRef.current?.remove();
        locationRef.current = L.circleMarker([coords.latitude, coords.longitude], {
          radius: 7,
          color: '#dff6ff',
          weight: 2,
          fillColor: '#4aa3ff',
          fillOpacity: 1,
        })
          .bindPopup('Your location', { closeButton: false })
          .addTo(map);
        map.stop();
        map.flyTo([coords.latitude, coords.longitude], 15, { duration: 0.7 });
        setCoordinates([coords.latitude, coords.longitude]);
        setStatus(`Located within ${Math.round(coords.accuracy)} m`);
        setLocating(false);
      },
      (error) => {
        setStatus(error.code === 1 ? 'Location permission denied' : 'Unable to determine location');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  const resetMap = () => {
    const map = mapRef.current;
    map?.stop();
    map?.flyTo(INITIAL_CENTER, 13, { duration: 0.65 });
    pinRef.current?.remove();
    locationRef.current?.remove();
    pinRef.current = null;
    locationRef.current = null;
    setQuery('');
    setResults([]);
    setCoordinates(INITIAL_CENTER);
    setStatus('View reset');
  };

  const activeStyle = MAP_STYLES[mapStyle];

  return (
    <div className={styles.app}>
      <div ref={containerRef} className={styles.map} aria-label="Interactive world map" />

      <section className={styles.panel} aria-label="Map controls">
        <div className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>Nammu OS · Navigation</span>
            <h1>Maps</h1>
          </div>
          <div className={styles.headingIcon}>
            <MapPin size={17} strokeWidth={1.5} aria-hidden="true" />
          </div>
        </div>

        <form className={styles.search} onSubmit={searchPlaces}>
          <Search size={13} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!event.target.value) setResults([]);
            }}
            placeholder="Search a city or place"
            aria-label="Search a city or place"
          />
          {query && !searching && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults([]);
              }}
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
          <button type="submit" disabled={query.trim().length < 2 || searching}>
            {searching ? '···' : 'Go'}
          </button>
        </form>

        {results.length > 0 && (
          <div className={styles.results} role="listbox" aria-label="Place results">
            {results.map((result) => (
              <button
                key={result.id}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => selectResult(result)}
              >
                <MapPin size={12} aria-hidden="true" />
                <span>
                  <strong>{result.name}</strong>
                  <small>{result.description}</small>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.styleRow}>
          <span>
            <Layers3 size={12} aria-hidden="true" /> Map style
          </span>
          <select
            value={mapStyle}
            disabled={changingStyle}
            onChange={(event) => changeStyle(event.target.value as MapStyleId)}
            aria-label="Map style"
          >
            {Object.entries(MAP_STYLES).map(([id, config]) => (
              <option key={id} value={id}>
                {config.label}
              </option>
            ))}
          </select>
        </div>

        <button
          className={styles.locateButton}
          type="button"
          onClick={locateUser}
          disabled={locating}
        >
          <LocateFixed size={13} aria-hidden="true" />
          {locating ? 'Locating…' : 'Use my location'}
        </button>

        <div className={styles.footer}>
          <div className={styles.telemetry}>
            <span className={styles.statusDot} />
            <span>{status}</span>
            <code>
              Z{zoom} · {coordinates[0].toFixed(4)}, {coordinates[1].toFixed(4)}
            </code>
          </div>
          <div className={styles.credits} aria-label="Map credits">
            {activeStyle.credits.map((credit) => (
              <a key={credit.label} href={credit.url} target="_blank" rel="noreferrer">
                {credit.label}
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className={styles.zoomControls} aria-label="Zoom controls">
        <button
          type="button"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => mapRef.current?.zoomIn(1, { animate: true })}
          aria-label="Zoom in"
        >
          <Plus size={15} />
        </button>
        <span>{zoom}</span>
        <button
          type="button"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => mapRef.current?.zoomOut(1, { animate: true })}
          aria-label="Zoom out"
        >
          <Minus size={15} />
        </button>
      </div>

      <button
        className={styles.resetButton}
        type="button"
        onClick={resetMap}
        aria-label="Reset map"
        title="Reset map"
      >
        <Crosshair size={14} />
      </button>
    </div>
  );
}
