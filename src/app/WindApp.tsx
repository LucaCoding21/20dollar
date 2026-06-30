"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Wind tracker — "is it too windy for badminton?"                   */
/*                                                                    */
/*  Live data from Open-Meteo (free, no API key). We translate raw    */
/*  km/h into a plain-language badminton verdict, because "12 km/h"   */
/*  means nothing until you know the shuttle is the lightest thing in */
/*  any sport (~5g) and gets pushed around by even a light breeze.    */
/* ------------------------------------------------------------------ */

const DEFAULT_LOC: Loc = { name: "Surrey", sub: "British Columbia, Canada", lat: 49.10635, lon: -122.82509 };
const LS_KEY = "wind.location";

type Loc = { name: string; sub?: string; lat: number; lon: number };

type Hour = {
  iso: string;
  hour: number;
  isNow: boolean;
  speed: number;
  gust: number;
  dir: number;
  temp: number;
  code: number;
};

type Wx = {
  current: {
    time: string;
    wind_speed_10m: number;
    wind_gusts_10m: number;
    wind_direction_10m: number;
    temperature_2m: number;
    weather_code: number;
  };
  hourly: {
    time: string[];
    wind_speed_10m: number[];
    wind_gusts_10m: number[];
    wind_direction_10m: number[];
    temperature_2m: number[];
    weather_code: number[];
  };
};

/* ------------------------------------------------------------------ */
/*  Wind → badminton scale  (the whole point of the app)              */
/* ------------------------------------------------------------------ */

// Tuned for a shuttlecock, not a soccer ball — these bands are gentler
// than a normal weather app because the birdie reacts to far less wind.
const BANDS = [
  { max: 8, label: "Calm", color: "#1f9e63", soft: "#e4f5ec", play: "Perfect for badminton" },
  { max: 16, label: "Breezy", color: "#c4860f", soft: "#fbf0d6", play: "Playable — slight drift" },
  { max: 25, label: "Windy", color: "#e07a2e", soft: "#fdeede", play: "Shuttle drifts a lot" },
  { max: Infinity, label: "Strong", color: "#e0514b", soft: "#fce9e8", play: "Too windy for shuttle" },
] as const;

type Band = (typeof BANDS)[number] & { index: number };

function bandFor(speed: number): Band {
  const i = BANDS.findIndex((b) => speed < b.max);
  const idx = i === -1 ? BANDS.length - 1 : i;
  return { ...BANDS[idx], index: idx };
}

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function compass(deg: number) {
  return DIRS[Math.round(deg / 45) % 8];
}

function formatHour(h: number) {
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${period}`;
}

/* ------------------------------------------------------------------ */
/*  Weather-code → icon kind (WMO codes)                              */
/* ------------------------------------------------------------------ */

function weatherKind(code: number): "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm" {
  if (code === 0) return "sun";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 71 && code <= 77) return "snow";
  if (code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "cloud";
}

/* ------------------------------------------------------------------ */
/*  Icons                                                             */
/* ------------------------------------------------------------------ */

function GridIcon({ className = "", color = "#2b2b2b" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {[[4, 4], [14, 4], [4, 14], [14, 14]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="6" height="6" rx="1.8" stroke={color} strokeWidth="2" />
      ))}
    </svg>
  );
}

function PinIcon({ className = "", color = "#2f63e6" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function SearchIcon({ className = "", color = "#9a9aa0" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="11" cy="11" r="6.5" stroke={color} strokeWidth="2" />
      <path d="M16 16l4 4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon({ className = "", color = "#2f63e6" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M20 11a8 8 0 1 0-.6 4M20 5v5h-5"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon({ className = "", color = "#8d8d93" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
      <path d="M12 11v5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="7.6" r="1.1" fill={color} />
    </svg>
  );
}

// A little arrow pointing the way the wind blows (meteorological dir = where
// it comes FROM, so the arrow rotates by dir + 180 to point downwind).
function WindArrow({ dir, color = "#5a6678", size = 14 }: { dir: number; color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ transform: `rotate(${dir + 180}deg)` }}>
      <path d="M12 4v16M12 4l-5 6M12 4l5 6" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Compact flat weather glyphs (day/night aware for clear & partly skies).
function WeatherGlyph({ code, night = false, size = 30 }: { code: number; night?: boolean; size?: number }) {
  const kind = weatherKind(code);
  const s = { width: size, height: size };
  const sun = "#f6b73c";
  const moon = "#e7d27a";
  const cloud = "#ffffff";
  const cloudEdge = "#cdd9f0";
  const drop = "#5a8fd6";

  if (kind === "sun") {
    if (night) {
      return (
        <svg viewBox="0 0 24 24" style={s} fill="none">
          <path d="M20 14.5A8 8 0 1 1 10.2 4 6.4 6.4 0 0 0 20 14.5Z" fill={moon} stroke="#cdb84e" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" style={s} fill="none">
        <circle cx="12" cy="12" r="5" fill={sun} />
        <g stroke={sun} strokeWidth="2" strokeLinecap="round">
          <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
        </g>
      </svg>
    );
  }

  if (kind === "partly") {
    return (
      <svg viewBox="0 0 24 24" style={s} fill="none">
        {night ? (
          <path d="M14 8.5A4.6 4.6 0 0 1 8.4 4 4.6 4.6 0 1 0 14 9.6Z" fill={moon} />
        ) : (
          <>
            <circle cx="8.5" cy="8" r="3.4" fill={sun} />
            <g stroke={sun} strokeWidth="1.6" strokeLinecap="round">
              <path d="M8.5 1.5v1.6M2 8h1.6M3.6 3.1l1.1 1.1M13.4 3.1l-1.1 1.1" />
            </g>
          </>
        )}
        <path d="M9 19h8.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5.8A3.4 3.4 0 0 0 9 19Z" fill={cloud} stroke={cloudEdge} strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === "fog") {
    return (
      <svg viewBox="0 0 24 24" style={s} fill="none">
        <path d="M7 13h9a3.2 3.2 0 0 0 .2-6.4 4.6 4.6 0 0 0-8.8.8A3.1 3.1 0 0 0 7 13Z" fill={cloud} stroke={cloudEdge} strokeWidth="1.3" strokeLinejoin="round" />
        <g stroke="#b9c2d4" strokeWidth="2" strokeLinecap="round">
          <path d="M5 17h12M7 20h10" />
        </g>
      </svg>
    );
  }

  if (kind === "rain") {
    return (
      <svg viewBox="0 0 24 24" style={s} fill="none">
        <path d="M7 14h9a3.4 3.4 0 0 0 .2-6.8 4.8 4.8 0 0 0-9.1.8A3.3 3.3 0 0 0 7 14Z" fill={cloud} stroke={cloudEdge} strokeWidth="1.3" strokeLinejoin="round" />
        <g stroke={drop} strokeWidth="2" strokeLinecap="round">
          <path d="M8.5 17l-1 2.5M12 17l-1 2.5M15.5 17l-1 2.5" />
        </g>
      </svg>
    );
  }

  if (kind === "snow") {
    return (
      <svg viewBox="0 0 24 24" style={s} fill="none">
        <path d="M7 13.5h9a3.4 3.4 0 0 0 .2-6.8 4.8 4.8 0 0 0-9.1.8A3.3 3.3 0 0 0 7 13.5Z" fill={cloud} stroke={cloudEdge} strokeWidth="1.3" strokeLinejoin="round" />
        <g fill="#9fc2ec">
          <circle cx="9" cy="18" r="1.1" />
          <circle cx="12.5" cy="19.5" r="1.1" />
          <circle cx="16" cy="18" r="1.1" />
        </g>
      </svg>
    );
  }

  if (kind === "storm") {
    return (
      <svg viewBox="0 0 24 24" style={s} fill="none">
        <path d="M7 13h9a3.4 3.4 0 0 0 .2-6.8 4.8 4.8 0 0 0-9.1.8A3.3 3.3 0 0 0 7 13Z" fill={cloud} stroke={cloudEdge} strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M12.5 13l-3 4h2.3l-1 4 3.7-5h-2.4l1.2-3Z" fill="#f6b73c" />
      </svg>
    );
  }

  // plain cloud
  return (
    <svg viewBox="0 0 24 24" style={s} fill="none">
      <path d="M7 17h9.5a3.6 3.6 0 0 0 .2-7.2 5 5 0 0 0-9.5.9A3.5 3.5 0 0 0 7 17Z" fill={cloud} stroke={cloudEdge} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Data                                                              */
/* ------------------------------------------------------------------ */

async function fetchWind(loc: Loc): Promise<Wx> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,weather_code` +
    `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,weather_code` +
    `&wind_speed_unit=kmh&forecast_days=2&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't reach the weather service.");
  return (await res.json()) as Wx;
}

async function searchCity(q: string): Promise<Loc[]> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`,
  );
  if (!res.ok) return [];
  const json = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[];
  };
  return (json.results ?? []).map((r) => ({
    name: r.name,
    sub: [r.admin1, r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

function loadSavedLoc(): Loc {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Loc;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOC;
}

/* ------------------------------------------------------------------ */
/*  Screen                                                            */
/* ------------------------------------------------------------------ */

export default function WindApp({ onExit }: { onExit: () => void }) {
  // Restore the saved location at mount (client-only — this app is ssr:false).
  const [loc, setLoc] = useState<Loc>(() => loadSavedLoc());
  const [wx, setWx] = useState<Wx | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  // Start with an awaited fetch (no synchronous setState) so the effect that
  // calls this never triggers a cascading render — same shape as the other apps.
  const load = useCallback(async (l: Loc) => {
    try {
      const data = await fetchWind(l);
      setWx(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(loc);
  }, [loc, load]);

  function chooseLoc(next: Loc) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setLoc(next);
    setPickerOpen(false);
  }

  // Upcoming hours: from the current hour forward, up to 24.
  const hours = useMemo<Hour[]>(() => {
    if (!wx) return [];
    const startKey = wx.current.time.slice(0, 13); // "YYYY-MM-DDTHH"
    const out: Hour[] = [];
    const h = wx.hourly;
    for (let i = 0; i < h.time.length; i++) {
      const iso = h.time[i];
      if (iso.slice(0, 13) < startKey) continue; // skip hours already gone
      out.push({
        iso,
        hour: Number(iso.slice(11, 13)),
        isNow: iso.slice(0, 13) === startKey,
        speed: Math.round(h.wind_speed_10m[i]),
        gust: Math.round(h.wind_gusts_10m[i]),
        dir: h.wind_direction_10m[i],
        temp: Math.round(h.temperature_2m[i]),
        code: h.weather_code[i],
      });
      if (out.length >= 24) break;
    }
    return out;
  }, [wx]);

  const now = wx?.current;
  const nowSpeed = now ? Math.round(now.wind_speed_10m) : 0;
  const nowBand = bandFor(nowSpeed);
  const nowHour = now ? Number(now.time.slice(11, 13)) : 12;
  const isNight = nowHour < 6 || nowHour >= 20;

  // Next ~2 hours: the current hour plus the next two marks.
  const next2 = hours.slice(0, 3);
  const next2Worst = next2.reduce<Band>((w, h) => (bandFor(h.speed).index > w.index ? bandFor(h.speed) : w), bandFor(0));
  const next2Worsens = next2.length > 1 && next2Worst.index > bandFor(next2[0].speed).index;

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col gap-3 px-4 pb-10 pt-[max(env(safe-area-inset-top),14px)]">
        {/* ---- header ---- */}
        <div className="relative flex items-center justify-center py-1.5">
          <button
            type="button"
            onClick={onExit}
            aria-label="Back to apps"
            className="absolute left-0 flex items-center gap-1 rounded-full bg-white/85 px-3 py-1.5 text-[13px] text-[#2b2b2b] shadow-[0_4px_12px_rgba(120,150,200,0.18)] backdrop-blur transition active:scale-95"
          >
            <GridIcon className="w-4" />
            Apps
          </button>
          <h1 className="font-daruma text-[26px] leading-none text-[#3a4a63] drop-shadow-[0_2px_3px_rgba(255,255,255,0.7)]">
            Wind
          </h1>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load(loc);
            }}
            aria-label="Refresh"
            className="absolute right-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/85 shadow-[0_4px_12px_rgba(120,150,200,0.18)] backdrop-blur transition active:scale-95"
          >
            <RefreshIcon className={`w-[18px] ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* ---- location pill ---- */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="mx-auto flex items-center gap-1.5 rounded-full bg-white/80 px-3.5 py-1.5 text-[14px] text-[#2b2b2b] shadow-[0_4px_12px_rgba(120,150,200,0.16)] backdrop-blur transition active:scale-95"
        >
          <PinIcon className="w-[15px]" />
          <span className="max-w-[220px] truncate">{loc.name}</span>
          <span className="text-[12px] text-[#8d8d93]">Change</span>
        </button>

        {error && (
          <div className="rounded-[18px] bg-white p-5 text-center shadow-[0_8px_24px_rgba(120,150,200,0.18)]">
            <p className="text-[28px]">🌬️</p>
            <p className="mt-1 text-[14px] text-[#2b2b2b]">{error}</p>
            <button
              type="button"
              onClick={() => load(loc)}
              className="mt-3 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] px-5 py-2 text-[14px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-95"
            >
              Try again
            </button>
          </div>
        )}

        {loading && !wx && !error && (
          <div className="flex h-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/60 border-t-[#3a4a63]" />
          </div>
        )}

        {now && !error && (
          <>
            {/* ---- HERO: right now ---- */}
            <section
              className="animate-pop-in rounded-[22px] p-4 shadow-[0_10px_30px_rgba(120,150,200,0.2)]"
              style={{ backgroundColor: nowBand.soft }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[13px] font-bold tracking-wide" style={{ color: nowBand.color }}>
                    RIGHT NOW
                  </p>
                  <div className="mt-0.5 flex items-end gap-1.5">
                    <span className="font-daruma text-[60px] leading-[0.8]" style={{ color: nowBand.color }}>
                      {nowSpeed}
                    </span>
                    <span className="mb-1.5 text-[15px] text-[#5a6678]">km/h</span>
                  </div>
                  <p className="mt-1.5 text-[17px] text-[#2b2b2b]">
                    <b style={{ color: nowBand.color }}>{nowBand.label}</b> — {nowBand.play}
                  </p>
                </div>

                <div className="flex flex-col items-center gap-1 pt-1">
                  <WeatherGlyph code={now.weather_code} night={isNight} size={44} />
                  <span className="text-[15px] text-[#5a6678]">{Math.round(now.temperature_2m)}°</span>
                </div>
              </div>

              {/* detail row */}
              <div className="mt-3 flex items-center justify-between rounded-[14px] bg-white/70 px-3.5 py-2 text-[13px] text-[#5a6678] backdrop-blur-sm">
                <span className="flex items-center gap-1.5">
                  <span className="text-[15px]">💨</span>
                  gusts <b className="font-bold text-[#2b2b2b]">{Math.round(now.wind_gusts_10m)}</b>
                </span>
                <span className="h-3 w-px bg-[#e0e4ee]" />
                <span className="flex items-center gap-1.5">
                  <WindArrow dir={now.wind_direction_10m} />
                  from {compass(now.wind_direction_10m)}
                </span>
                <span className="h-3 w-px bg-[#e0e4ee]" />
                <span className="flex items-center gap-1.5">
                  <WeatherGlyph code={now.weather_code} night={isNight} size={16} />
                  {Math.round(now.temperature_2m)}°
                </span>
              </div>
            </section>

            {/* ---- next 2 hours ---- */}
            <div className="rounded-[18px] bg-white p-3.5 shadow-[0_8px_24px_rgba(120,150,200,0.18)]">
              <p className="text-[12px] text-[#8d8d93]">Next 2 hours</p>
              <p className="mt-1 text-[16px] leading-snug text-[#2b2b2b]">
                {next2Worsens ? (
                  <>Calm now, <b style={{ color: next2Worst.color }}>{next2Worst.label.toLowerCase()}</b> soon</>
                ) : (
                  <>Staying <b style={{ color: next2Worst.color }}>{next2Worst.label.toLowerCase()}</b></>
                )}
                <span className="text-[13px] text-[#8d8d93]"> · {next2Worst.play}</span>
              </p>
            </div>

            {/* ---- hourly strip (scan the colors) ---- */}
            <section className="rounded-[22px] bg-white/85 p-3 shadow-[0_8px_24px_rgba(120,150,200,0.18)] backdrop-blur-sm">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <h2 className="text-[14px] text-[#2b2b2b]">Hour by hour</h2>
                <span className="text-[11px] text-[#a9a9b0]">swipe →</span>
              </div>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {hours.map((h) => {
                  const b = bandFor(h.speed);
                  const night = h.hour < 6 || h.hour >= 20;
                  return (
                    <div
                      key={h.iso}
                      className="flex w-[58px] shrink-0 flex-col items-center gap-1 rounded-[16px] py-2.5"
                      style={{ backgroundColor: b.soft }}
                    >
                      <span className={`text-[12px] ${h.isNow ? "font-bold text-[#2b2b2b]" : "text-[#5a6678]"}`}>
                        {h.isNow ? "Now" : formatHour(h.hour)}
                      </span>
                      <WeatherGlyph code={h.code} night={night} size={24} />
                      <span className="font-daruma text-[20px] leading-none" style={{ color: b.color }}>
                        {h.speed}
                      </span>
                      <span className="text-[9px] leading-none text-[#8d8d93]">km/h</span>
                      <div className="mt-0.5 flex items-center gap-0.5 text-[9px] text-[#a9a9b0]">
                        <WindArrow dir={h.dir} color="#a9a9b0" size={9} />
                        <span>{h.temp}°</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ---- the scale (so km/h actually means something) ---- */}
            <section className="rounded-[22px] bg-white/85 p-3.5 shadow-[0_8px_24px_rgba(120,150,200,0.18)] backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between px-0.5">
                <h2 className="text-[14px] text-[#2b2b2b]">Is that windy? (for badminton)</h2>
                <button
                  type="button"
                  onClick={() => setInfoOpen(true)}
                  aria-label="How this works"
                  className="flex h-6 w-6 items-center justify-center rounded-full transition active:scale-90"
                >
                  <InfoIcon className="w-[18px]" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {BANDS.map((b, i) => {
                  const lo = i === 0 ? 0 : BANDS[i - 1].max;
                  const range = b.max === Infinity ? `${lo}+ km/h` : `${lo}–${b.max} km/h`;
                  return (
                    <div
                      key={b.label}
                      className="flex items-center gap-2 rounded-[14px] px-2.5 py-2"
                      style={{ backgroundColor: b.soft }}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                      <div className="min-w-0">
                        <p className="text-[13px] leading-tight text-[#2b2b2b]">
                          {b.label} <span className="text-[11px] text-[#8d8d93]">{range}</span>
                        </p>
                        <p className="truncate text-[11px] leading-tight text-[#8d8d93]">{b.play}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <p className="px-2 text-center text-[11px] text-[#5a6678] drop-shadow-[0_1px_2px_rgba(255,255,255,0.6)]">
              Wind data from Open-Meteo · tuned for the shuttlecock
            </p>
          </>
        )}
      </div>

      {pickerOpen && (
        <LocationSheet current={loc} onClose={() => setPickerOpen(false)} onPick={chooseLoc} />
      )}
      {infoOpen && <InfoSheet onClose={() => setInfoOpen(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Location picker                                                   */
/* ------------------------------------------------------------------ */

function LocationSheet({
  current,
  onClose,
  onPick,
}: {
  current: Loc;
  onClose: () => void;
  onPick: (l: Loc) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Loc[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Debounced city search. All state updates live inside the timeout so the
  // effect body itself never setStates synchronously.
  useEffect(() => {
    const term = q.trim();
    const t = setTimeout(async () => {
      if (term.length < 2) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        setResults(await searchCity(term));
      } finally {
        setSearching(false);
      }
    }, term.length < 2 ? 0 : 300);
    return () => clearTimeout(t);
  }, [q]);

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setGeoError("Location isn't available on this device.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onPick({
          name: "My location",
          sub: "Using GPS",
          lat: Number(pos.coords.latitude.toFixed(4)),
          lon: Number(pos.coords.longitude.toFixed(4)),
        });
      },
      () => {
        setLocating(false);
        setGeoError("Couldn't get your location. Try searching a city instead.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  }

  return (
    <div
      className="animate-backdrop-in fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-sheet-up w-full max-w-[420px] rounded-[22px] bg-white p-4 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="mb-3 text-center text-[16px] text-[#2b2b2b]">Where are you playing?</h2>

        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99] disabled:opacity-60"
        >
          <PinIcon className="w-[17px]" color="#ffffff" />
          {locating ? "Finding you…" : "Use my location"}
        </button>

        <div className="mb-2 flex items-center gap-2 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
          <SearchIcon className="w-[18px]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a city…"
            autoFocus
            className="w-full bg-transparent text-[15px] text-[#2b2b2b] outline-none placeholder:text-[#aeb1b9]"
          />
        </div>

        {geoError && <p className="mb-2 px-1 text-[12px] text-[#d4453e]">{geoError}</p>}

        <div className="max-h-[40vh] overflow-y-auto">
          {searching && results.length === 0 && (
            <p className="py-3 text-center text-[12px] text-[#a9a9b0]">Searching…</p>
          )}
          {!searching && q.trim().length >= 2 && results.length === 0 && (
            <p className="py-3 text-center text-[12px] text-[#a9a9b0]">No matches — try another spelling.</p>
          )}
          {results.map((r, i) => {
            const active = r.lat === current.lat && r.lon === current.lon;
            return (
              <button
                key={`${r.lat},${r.lon},${i}`}
                type="button"
                onClick={() => onPick(r)}
                className="flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2.5 text-left transition active:scale-[0.99] hover:bg-[#f6f8fd]"
              >
                <PinIcon className="w-[16px]" color={active ? "#2f63e6" : "#a9a9b0"} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-[#2b2b2b]">{r.name}</span>
                  {r.sub && <span className="block truncate text-[12px] text-[#8d8d93]">{r.sub}</span>}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-[14px] bg-[#f1f2f6] py-2.5 text-[15px] text-[#2b2b2b] transition active:scale-[0.99]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Info sheet — what the numbers mean                                */
/* ------------------------------------------------------------------ */

function InfoSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="animate-backdrop-in fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-sheet-up w-full max-w-[420px] rounded-[22px] bg-white p-5 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="mb-1 text-center text-[18px] text-[#2b2b2b]">🏸 Wind &amp; the shuttle</h2>
        <p className="mb-4 text-center text-[13px] text-[#8d8d93]">
          A shuttlecock weighs about 5 grams — the lightest thing in any sport — so it feels wind way before you do.
        </p>

        <div className="space-y-2">
          {BANDS.map((b, i) => {
            const lo = i === 0 ? 0 : BANDS[i - 1].max;
            const range = b.max === Infinity ? `${lo}+ km/h` : `${lo}–${b.max} km/h`;
            return (
              <div key={b.label} className="flex items-start gap-3 rounded-[14px] px-3 py-2.5" style={{ backgroundColor: b.soft }}>
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                <div>
                  <p className="text-[14px] text-[#2b2b2b]">
                    {b.label} <span className="text-[12px] text-[#8d8d93]">· {range}</span>
                  </p>
                  <p className="text-[12px] text-[#8d8d93]">{b.play}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-[14px] bg-[#eaf2fd] px-3.5 py-3">
          <p className="text-[13px] text-[#2b2b2b]">💨 Watch the gusts</p>
          <p className="mt-0.5 text-[12px] text-[#5a6678]">
            Steady wind you can adjust to — sudden gusts are what really throw a serve off. The big card shows the
            current gust speed so you know what you&apos;re really up against.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99]"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
