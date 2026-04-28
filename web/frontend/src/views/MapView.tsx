import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import {
  fetchAffiliationLinks,
  fetchAffiliations,
  type AffiliationGeo,
  type VirtualLink,
} from "../lib/api";
import { NODE_COLORS } from "../lib/palette";

const TILE_OPTIONS = [
  {
    id: "osm",
    label: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  {
    id: "carto-dark",
    label: "Carto Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: "carto-light",
    label: "Carto Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
];

interface Props {
  onToast: (kind: "success" | "error" | "info", text: string) => void;
}

function FitToMarkers({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
  }, [points, map]);
  return null;
}

export function MapView({ onToast }: Props) {
  const [affs, setAffs] = useState<AffiliationGeo[]>([]);
  const [links, setLinks] = useState<VirtualLink[]>([]);
  const [tile, setTile] = useState(TILE_OPTIONS[1]);
  const [showLinks, setShowLinks] = useState(true);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [a, l] = await Promise.all([fetchAffiliations(), fetchAffiliationLinks()]);
      setAffs(a);
      setLinks(l);
    } catch (err) {
      const e = err as { message?: string };
      onToast("error", `Failed to load map data: ${e?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const points = useMemo<[number, number][]>(
    () =>
      affs
        .filter((a) => typeof a.latitude === "number" && typeof a.longitude === "number")
        .map((a) => [a.latitude as number, a.longitude as number]),
    [affs],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div className="toolbar">
        <div className="field">
          <label>Basemap</label>
          <select
            value={tile.id}
            onChange={(e) =>
              setTile(TILE_OPTIONS.find((t) => t.id === e.target.value) ?? TILE_OPTIONS[1])
            }
          >
            {TILE_OPTIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Virtual links</label>
          <button
            onClick={() => setShowLinks((s) => !s)}
            style={{ fontSize: 12, padding: "5px 10px" }}
          >
            {showLinks ? "On (shared sectors)" : "Off"}
          </button>
        </div>
        <div className="legend" style={{ marginLeft: "auto" }}>
          <span>
            <span className="swatch" style={{ background: NODE_COLORS.Affiliation }} />
            Affiliation
          </span>
          <span>
            <span className="swatch" style={{ background: NODE_COLORS.Sector }} />
            virtual link · shared Sector
          </span>
        </div>
        <button onClick={reload} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="map-host">
        <MapContainer
          center={[20, 0]}
          zoom={2}
          style={{ height: "100%", width: "100%" }}
          worldCopyJump
          scrollWheelZoom
        >
          <TileLayer key={tile.id} url={tile.url} attribution={tile.attribution} />
          <FitToMarkers points={points} />
          {showLinks &&
            links
              .filter(
                (l) =>
                  typeof l.source.latitude === "number" &&
                  typeof l.source.longitude === "number" &&
                  typeof l.target.latitude === "number" &&
                  typeof l.target.longitude === "number",
              )
              .map((l, idx) => (
                <Polyline
                  key={idx}
                  positions={[
                    [l.source.latitude as number, l.source.longitude as number],
                    [l.target.latitude as number, l.target.longitude as number],
                  ]}
                  pathOptions={{
                    color: NODE_COLORS.Sector,
                    weight: 1.5,
                    opacity: 0.7,
                    dashArray: "4 4",
                  }}
                >
                  <Tooltip sticky>
                    <strong>{l.source.name}</strong> ↔ <strong>{l.target.name}</strong>
                    <div className="muted">
                      via sector{l.sectors.length === 1 ? "" : "s"}: {l.sectors.join(", ")}
                    </div>
                  </Tooltip>
                </Polyline>
              ))}
          {affs
            .filter(
              (a) => typeof a.latitude === "number" && typeof a.longitude === "number",
            )
            .map((a) => (
              <CircleMarker
                key={a.name}
                center={[a.latitude as number, a.longitude as number]}
                radius={9}
                pathOptions={{
                  color: "#0f172a",
                  weight: 1,
                  fillColor: NODE_COLORS.Affiliation,
                  fillOpacity: 0.92,
                }}
              >
                <Popup>
                  <h3>{a.name}</h3>
                  {a.address && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {a.address}
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    <strong>Sectors</strong>
                    <ul>
                      {a.sectors.length === 0 && <li className="muted">none</li>}
                      {a.sectors.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                    <strong>Collaborators</strong>
                    <ul>
                      {a.collaborators.length === 0 && <li className="muted">none</li>}
                      {a.collaborators.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </Popup>
                <Tooltip>{a.name}</Tooltip>
              </CircleMarker>
            ))}
        </MapContainer>
      </div>
    </div>
  );
}
