import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  format,
  fromUnixTime,
  isAfter,
  startOfDay,
  subDays,
  subHours,
  subMonths,
} from "date-fns";
import {
  getFallbackReadings,
  loginWithEmailPassword,
  logoutCurrentUser,
  observeAuth,
  subscribeToLiveReadings,
} from "./firebaseStream";

const UNIT_BY_METRIC = {
  temperature: "deg C",
  humidity: "%",
  pressure: "hPa",
  altitude: "m",
  rain: "raw",
  uv: "index",
  mq5: "ppm",
  mq5_rs_kohm: "kOhm",
  mics5524: "V",
  mics5524_co_ppm: "ppm",
  mics5524_ch4_ppm: "ppm",
  mics5524_h2_ppm: "ppm",
  mics5524_ethanol_ppm: "ppm",
  mics5524_rs_kohm: "kOhm",
  dust_density_ugm3: "ug/m³",
  dust_voltage_v: "V",
  wind_speed_kmh: "km/h",
  wind_speed_ms: "m/s",
  wind_voltage_v: "V",
  wind_direction_deg: "deg",
  mpu6050_accel_x: "g",
  mpu6050_accel_y: "g",
  mpu6050_accel_z: "g",
  mpu6050_gyro_x: "deg/s",
  mpu6050_gyro_y: "deg/s",
  mpu6050_gyro_z: "deg/s",
};

const THRESHOLDS_BY_METRIC = {
  temperature: { type: "range", green: [18, 30], yellow: [15, 35] },
  humidity: { type: "range", green: [35, 70], yellow: [25, 80] },
  pressure: { type: "range", green: [980, 1030], yellow: [960, 1050] },
  altitude: { type: "max", green: 1500, yellow: 2200 },
  uv: { type: "max", green: 3, yellow: 6 },
  mq5: { type: "max", green: 300, yellow: 700 },
  mics5524: { type: "max", green: 3.5, yellow: 4.5 },
  rain: { type: "max", green: 1500, yellow: 3000 },
};

const STATUS_LABEL = {
  green: "Normal",
  yellow: "Watch",
  red: "Critical",
  unknown: "Unknown",
};

const STATUS_COLOR = {
  green: "#66ff96",
  yellow: "#ffd968",
  red: "#ff7b7b",
  unknown: "#9cb2da",
};

const TREND_COLOR_PALETTE = [
  "#54f5ff",
  "#9dff47",
  "#f7b851",
  "#ee7b62",
  "#a1b8ff",
  "#7effd4",
  "#ffd968",
  "#f7a7ff",
  "#8ef3a7",
  "#79d5ff",
  "#ffc59b",
  "#c0ff72",
];

const HIDDEN_STANDALONE_METRICS = new Set([
  "mics5524_rs_kohm",
  "mq5_rs_kohm",
  "mics_rs",
  "mq5_rs",
  "dust_voltage_v",
  "wind_voltage_v",
]);

const NON_TREND_METRICS = new Set([
  "timestamp",
  "rain_status",
  "wind_direction_text",
  ...HIDDEN_STANDALONE_METRICS,
]);

const METRIC_LABEL_OVERRIDES = {
  mics5524_ch4_ppm: "ch4 ppm",
  mics5524_co_ppm: "co ppm",
  mics5524_h2_ppm: "h2 ppm",
  mics5524_ethanol_ppm: "ethanol ppm",
};

const SENSOR_GROUP_DEFINITIONS = [
  {
    key: "accelerometer",
    title: "Accelerometer",
    visibilityMetrics: [
      "mpu6050_accel_x",
      "mpu6050_accel_y",
      "mpu6050_accel_z",
    ],
    fields: [
      { label: "X", metric: "mpu6050_accel_x", unit: "g" },
      { label: "Y", metric: "mpu6050_accel_y", unit: "g" },
      { label: "Z", metric: "mpu6050_accel_z", unit: "g" },
    ],
  },
  {
    key: "gyroscope",
    title: "Gyroscope",
    visibilityMetrics: ["mpu6050_gyro_x", "mpu6050_gyro_y", "mpu6050_gyro_z"],
    fields: [
      { label: "X", metric: "mpu6050_gyro_x", unit: "deg/s" },
      { label: "Y", metric: "mpu6050_gyro_y", unit: "deg/s" },
      { label: "Z", metric: "mpu6050_gyro_z", unit: "deg/s" },
    ],
  },
  {
    key: "dust",
    title: "Dust",
    visibilityMetrics: ["dust_density_ugm3"],
    fields: [
      { label: "Dust density", metric: "dust_density_ugm3", unit: "ug/m3" },
    ],
  },
  // {
  //   key: "mics5524",
  //   title: "MICS 5524",
  //   visibilityMetrics: [
  //     "mics5524_co_ppm",
  //     "mics5524_ch4_ppm",
  //     "mics5524_h2_ppm",
  //     "mics5524_ethanol_ppm",
  //     "mics5524_rs_kohm",
  //   ],
  //   fields: [
  //     { label: "CO", metric: "mics5524_co_ppm", unit: "ppm" },
  //     { label: "CH4", metric: "mics5524_ch4_ppm", unit: "ppm" },
  //     { label: "H2", metric: "mics5524_h2_ppm", unit: "ppm" },
  //     { label: "Ethanol", metric: "mics5524_ethanol_ppm", unit: "ppm" },
  //     { label: "Rs", metric: "mics5524_rs_kohm", unit: "kOhm" },
  //   ],
  // },
  {
    key: "mq5",
    title: "MQ5 / LPG",
    visibilityMetrics: ["mq5"],
    statusMetrics: ["mq5"],
    fields: [
      { label: "LPG ppm", metric: "mq5", unit: "ppm" },
      {
        label: "Status",
        resolve: (reading) => STATUS_LABEL[getStatus("mq5", reading?.mq5)],
      },
    ],
  },
  {
    key: "rain",
    title: "Rain",
    visibilityMetrics: ["rain", "rain_status"],
    statusMetrics: ["rain"],
    fields: [
      { label: "Rain raw", metric: "rain", unit: "raw" },
      {
        label: "Status",
        metric: "rain_status",
        resolve: (reading) =>
          reading?.rain_status ??
          STATUS_LABEL[getStatus("rain", reading?.rain)],
      },
    ],
  },
  {
    key: "wind-direction",
    title: "Wind Direction",
    visibilityMetrics: ["wind_direction_deg", "wind_direction_text"],
    fields: [
      { label: "Angle", metric: "wind_direction_deg", unit: "deg" },
      { label: "Heading", metric: "wind_direction_text" },
    ],
  },
  {
    key: "wind-speed",
    title: "Wind Speed",
    visibilityMetrics: ["wind_speed_kmh", "wind_speed_ms"],
    fields: [
      { label: "Speed", metric: "wind_speed_kmh", unit: "km/h" },
      { label: "Speed", metric: "wind_speed_ms", unit: "m/s" },
    ],
  },
];

const SENSOR_GROUP_METRICS = new Set(
  SENSOR_GROUP_DEFINITIONS.flatMap((group) =>
    group.fields.flatMap((field) => (field.metric ? [field.metric] : [])),
  ),
);

function formatMetricName(metric) {
  if (!metric || typeof metric !== "string") {
    return "Unknown";
  }

  if (METRIC_LABEL_OVERRIDES[metric]) {
    return METRIC_LABEL_OVERRIDES[metric];
  }

  return metric
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (text) => text.toUpperCase());
}

function isHiddenStandaloneMetric(metric) {
  if (!metric || typeof metric !== "string") {
    return false;
  }

  const normalizedMetric = metric.toLowerCase();
  return HIDDEN_STANDALONE_METRICS.has(normalizedMetric);
}

function toFixedNumber(value) {
  if (!Number.isFinite(Number(value))) {
    return "--";
  }
  return Number(value).toFixed(2);
}

function formatDisplayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }

  if (typeof value === "number") {
    return toFixedNumber(value);
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && String(value).trim() !== "") {
    return toFixedNumber(numericValue);
  }

  return String(value);
}

function combineStatuses(statuses) {
  if (statuses.includes("red")) {
    return "red";
  }
  if (statuses.includes("yellow")) {
    return "yellow";
  }
  if (statuses.includes("green")) {
    return "green";
  }
  return "unknown";
}

function csvEscape(rawValue) {
  const value = String(rawValue ?? "");
  if (!/[",\n]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getStatus(metric, value) {
  const config = THRESHOLDS_BY_METRIC[metric];
  const numeric = Number(value);

  if (!config || !Number.isFinite(numeric)) {
    return "unknown";
  }

  if (config.type === "range") {
    const [greenMin, greenMax] = config.green;
    const [yellowMin, yellowMax] = config.yellow;

    if (numeric >= greenMin && numeric <= greenMax) {
      return "green";
    }
    if (numeric >= yellowMin && numeric <= yellowMax) {
      return "yellow";
    }
    return "red";
  }

  if (config.type === "max") {
    if (numeric <= config.green) {
      return "green";
    }
    if (numeric <= config.yellow) {
      return "yellow";
    }
    return "red";
  }

  return "unknown";
}

function getSparklineData(readings, metric, hours = 6) {
  const start = subHours(new Date(), hours);
  return readings
    .filter((entry) => entry && Number.isFinite(Number(entry[metric])))
    .filter((entry) => isAfter(fromUnixTime(Number(entry.timestamp)), start))
    .slice(-40)
    .map((entry) => ({
      value: Number(entry[metric]),
      stamp: Number(entry.timestamp),
    }));
}

function computeScore(reading) {
  if (!reading) {
    return { score: 0, label: "No Data" };
  }

  const temp = Number(reading.temperature ?? 0);
  const humidity = Number(reading.humidity ?? 0);
  const mq5 = Number(reading.mq5 ?? 0);
  const uv = Number(reading.uv ?? 0);

  const comfort = Math.max(
    0,
    100 - Math.abs(temp - 24) * 4 - Math.abs(humidity - 55) * 1.2,
  );
  const pollutionPenalty = mq5 > 0 ? Math.min(45, mq5 / 20) : 0;
  const uvPenalty = uv > 0 ? Math.min(20, uv * 1.8) : 0;

  const base = Math.max(0, comfort - pollutionPenalty - uvPenalty);
  const score = Math.round((base / 100) * 10);

  if (score >= 8) {
    return { score, label: "Excellent" };
  }
  if (score >= 6) {
    return { score, label: "Good" };
  }
  if (score >= 4) {
    return { score, label: "Moderate" };
  }
  return { score, label: "Poor" };
}

function aggregateReadings(readings, range, metrics) {
  if (!Array.isArray(metrics) || metrics.length === 0) {
    return [];
  }

  const now = new Date();
  const start =
    range === "day"
      ? subDays(now, 1)
      : range === "week"
        ? subDays(now, 7)
        : subMonths(now, 1);

  const grouped = new Map();

  for (const reading of readings) {
    const date = fromUnixTime(Number(reading.timestamp));
    if (!isAfter(date, start)) {
      continue;
    }

    const key =
      range === "day"
        ? format(date, "HH:00")
        : format(startOfDay(date), "MMM d");

    const record = grouped.get(key) ?? {
      key,
      count: 0,
      sums: {},
      counts: {},
    };

    record.count += 1;

    for (const metric of metrics) {
      const numericValue = Number(reading[metric]);
      if (!Number.isFinite(numericValue)) {
        continue;
      }

      record.sums[metric] = (record.sums[metric] ?? 0) + numericValue;
      record.counts[metric] = (record.counts[metric] ?? 0) + 1;
    }

    grouped.set(key, record);
  }

  return [...grouped.values()].map((row) => {
    const point = { label: row.key };

    for (const metric of metrics) {
      const metricCount = row.counts[metric] ?? 0;
      point[metric] =
        metricCount > 0
          ? Number((row.sums[metric] / metricCount).toFixed(2))
          : null;
    }

    return point;
  });
}

function Gauge({ score, label }) {
  const normalized = Math.max(0, Math.min(10, score));
  const angle = (normalized / 10) * 360;

  return (
    <div className="gauge-shell">
      <div
        className="gauge-circle"
        style={{
          "--gauge-angle": `${angle}deg`,
        }}
      >
        <div className="gauge-inner">
          <h2>{normalized}</h2>
          <p>{label}</p>
        </div>
      </div>
    </div>
  );
}

function SensorCard({ metric, value, sparklineData, status }) {
  return (
    <article className="sensor-card">
      <div className="sensor-head-row">
        <p className="sensor-title">{formatMetricName(metric)}</p>
        <span className={`status-pill status-${status}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      <div className="sensor-value-row">
        <strong>{toFixedNumber(value)}</strong>
        <span>{UNIT_BY_METRIC[metric] ?? ""}</span>
      </div>
      <div className="sparkline-wrap" aria-label={`${metric} sparkline`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparklineData}>
            <Line
              dataKey="value"
              stroke={STATUS_COLOR[status]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function SensorGroupCard({ title, rows, status }) {
  return (
    <article className="sensor-card sensor-card-group">
      <div className="sensor-head-row">
        <p className="sensor-title">{title}</p>
        <span className={`status-pill status-${status}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      <div className="sensor-group-list">
        {rows.map((row) => (
          <div className="sensor-group-row" key={row.label}>
            <span className="sensor-group-label">{row.label}</span>
            <span className="sensor-group-value">
              <strong>{formatDisplayValue(row.value)}</strong>
              {row.unit ? <span>{row.unit}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

function normalizeAuthError(error) {
  const code = String(error?.code ?? "");

  if (code.includes("auth/invalid-credential")) {
    return "Invalid email or password.";
  }
  if (code.includes("auth/user-disabled")) {
    return "This account has been disabled.";
  }
  if (code.includes("auth/too-many-requests")) {
    return "Too many attempts. Please try again later.";
  }

  return error?.message || "Authentication failed.";
}

function App() {
  const [readings, setReadings] = useState([]);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [source, setSource] = useState("connecting");
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [sensorCardOrder, setSensorCardOrder] = useState([]);
  const [draggingCardKey, setDraggingCardKey] = useState("");
  const [dragOverCardKey, setDragOverCardKey] = useState("");
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission;
  });
  const lastRedAlertRef = useRef("");

  useEffect(() => {
    const unsubscribe = observeAuth(
      (user) => {
        setAuthUser(user);
        setAuthReady(true);
      },
      (firebaseError) => {
        setAuthReady(true);
        setAuthError(normalizeAuthError(firebaseError));
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    let mounted = true;

    if (!authUser) {
      setSource("local-export");
      getFallbackReadings()
        .then((fallback) => {
          if (!mounted) {
            return;
          }
          setReadings(fallback);
        })
        .catch((fallbackError) => {
          if (!mounted) {
            return;
          }
          setError(fallbackError.message);
        });

      return () => {
        mounted = false;
      };
    }

    const live = subscribeToLiveReadings(
      authUser.uid,
      (liveReadings) => {
        if (!mounted) {
          return;
        }

        setError("");
        setReadings(liveReadings);
        setSource("firebase-live");
      },
      async (firebaseError) => {
        if (!mounted) {
          return;
        }

        setError(firebaseError.message);
        setSource("local-export");
        try {
          const fallback = await getFallbackReadings();
          if (mounted) {
            setReadings(fallback);
          }
        } catch (fallbackError) {
          if (mounted) {
            setError(fallbackError.message);
          }
        }
      },
    );

    if (!live.connected) {
      getFallbackReadings()
        .then((fallback) => {
          if (!mounted) {
            return;
          }
          setReadings(fallback);
          setSource("local-export");
        })
        .catch((fallbackError) => {
          if (mounted) {
            setError(fallbackError.message);
          }
        });
    }

    return () => {
      mounted = false;
      live.unsubscribe();
    };
  }, [authReady, authUser]);

  const latest = readings[readings.length - 1];
  const quality = useMemo(() => computeScore(latest), [latest]);

  const trendMetrics = useMemo(() => {
    if (!readings || readings.length === 0) {
      return [];
    }

    const metrics = new Set();

    for (const reading of readings) {
      for (const [metric, value] of Object.entries(reading)) {
        if (NON_TREND_METRICS.has(metric)) {
          continue;
        }

        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) {
          metrics.add(metric);
        }
      }
    }

    return [...metrics].sort((a, b) => a.localeCompare(b));
  }, [readings]);

  const dailySeries = useMemo(
    () => aggregateReadings(readings, "day", trendMetrics),
    [readings, trendMetrics],
  );
  const weeklySeries = useMemo(
    () => aggregateReadings(readings, "week", trendMetrics),
    [readings, trendMetrics],
  );

  const liveTrendData = useMemo(() => {
    if (!readings || readings.length === 0 || trendMetrics.length === 0) {
      return [];
    }

    const lastHour = subHours(new Date(), 1);

    return readings
      .filter(
        (entry) =>
          entry.timestamp &&
          isAfter(fromUnixTime(Number(entry.timestamp)), lastHour),
      )
      .map((entry) => {
        const point = {
          timestamp: entry.timestamp
            ? format(fromUnixTime(Number(entry.timestamp)), "HH:mm:ss")
            : "",
        };

        for (const metric of trendMetrics) {
          const numericValue = Number(entry[metric]);
          point[metric] = Number.isFinite(numericValue) ? numericValue : null;
        }

        return point;
      })
      .slice(-50);
  }, [readings, trendMetrics]);

  const sensorCards = useMemo(() => {
    if (!latest) {
      return [];
    }

    const groupedCards = SENSOR_GROUP_DEFINITIONS.map((group) => {
      const rows = group.fields.map((field) => ({
        label: field.label,
        value: field.resolve ? field.resolve(latest) : latest[field.metric],
        unit: field.unit,
      }));

      const hasVisibleData = group.visibilityMetrics.some(
        (metric) => latest[metric] !== undefined && latest[metric] !== null,
      );

      if (!hasVisibleData) {
        return null;
      }

      const statusSource = (group.statusMetrics ?? group.visibilityMetrics)
        .map((metric) => getStatus(metric, latest[metric]))
        .filter(Boolean);

      return {
        kind: "group",
        key: group.key,
        title: group.title,
        status: combineStatuses(statusSource),
        rows,
      };
    }).filter(Boolean);

    const standaloneCards = Object.entries(latest)
      .filter(
        ([metric]) =>
          metric !== "timestamp" &&
          !SENSOR_GROUP_METRICS.has(metric) &&
          !isHiddenStandaloneMetric(metric),
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([metric, value]) => ({
        kind: "single",
        key: metric,
        metric,
        value,
        status: getStatus(metric, value),
        sparklineData: getSparklineData(readings, metric),
      }));

    return [...groupedCards, ...standaloneCards];
  }, [latest, readings]);

  const alertSummary = useMemo(() => {
    const red = sensorCards.filter((item) => item.status === "red");
    const yellow = sensorCards.filter((item) => item.status === "yellow");
    return { red, yellow };
  }, [sensorCards]);

  useEffect(() => {
    const currentKeys = sensorCards.map((card) => card.key);

    setSensorCardOrder((previous) => {
      const kept = previous.filter((key) => currentKeys.includes(key));
      const added = currentKeys.filter((key) => !kept.includes(key));
      return [...kept, ...added];
    });
  }, [sensorCards]);

  const orderedSensorCards = useMemo(() => {
    if (sensorCards.length <= 1) {
      return sensorCards;
    }

    const cardByKey = new Map(sensorCards.map((card) => [card.key, card]));
    const arranged = sensorCardOrder
      .map((key) => cardByKey.get(key))
      .filter(Boolean);

    if (arranged.length !== sensorCards.length) {
      return sensorCards;
    }

    return arranged;
  }, [sensorCards, sensorCardOrder]);

  const handleCardDragStart = (event, sourceKey) => {
    setDraggingCardKey(sourceKey);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sourceKey);
  };

  const handleCardDragOver = (event, targetKey) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverCardKey !== targetKey) {
      setDragOverCardKey(targetKey);
    }
  };

  const handleCardDrop = (event, targetKey) => {
    event.preventDefault();

    const sourceKey =
      draggingCardKey || event.dataTransfer.getData("text/plain");
    if (!sourceKey || sourceKey === targetKey) {
      setDragOverCardKey("");
      setDraggingCardKey("");
      return;
    }

    setSensorCardOrder((previous) => {
      const orderedKeys =
        previous.length > 0
          ? [...previous]
          : sensorCards.map((card) => card.key);
      const sourceIndex = orderedKeys.indexOf(sourceKey);
      const targetIndex = orderedKeys.indexOf(targetKey);

      if (sourceIndex < 0 || targetIndex < 0) {
        return previous;
      }

      const [moved] = orderedKeys.splice(sourceIndex, 1);
      orderedKeys.splice(targetIndex, 0, moved);
      return orderedKeys;
    });

    setDragOverCardKey("");
    setDraggingCardKey("");
  };

  const handleCardDragEnd = () => {
    setDragOverCardKey("");
    setDraggingCardKey("");
  };

  useEffect(() => {
    if (
      notificationPermission !== "granted" ||
      alertSummary.red.length === 0 ||
      typeof window === "undefined" ||
      !("Notification" in window)
    ) {
      return;
    }

    const signature = alertSummary.red
      .map((item) => item.metric || item.key)
      .sort()
      .join("|");

    if (!signature || signature === lastRedAlertRef.current) {
      return;
    }

    lastRedAlertRef.current = signature;
    const list = alertSummary.red
      .slice(0, 4)
      .map((item) => (item.metric ? formatMetricName(item.metric) : item.title))
      .join(", ");

    new Notification("Critical sensor alert", {
      body:
        alertSummary.red.length > 1
          ? `${alertSummary.red.length} sensors are critical: ${list}`
          : `${list} is critical now.`,
    });
  }, [alertSummary, notificationPermission]);

  const handleSignIn = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      await loginWithEmailPassword(loginForm.email.trim(), loginForm.password);
      setLoginForm((current) => ({ ...current, password: "" }));
    } catch (signInError) {
      setAuthError(normalizeAuthError(signInError));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setAuthError("");
    setAuthLoading(true);

    try {
      await logoutCurrentUser();
    } catch (signOutError) {
      setAuthError(normalizeAuthError(signOutError));
    } finally {
      setAuthLoading(false);
    }
  };

  const requestNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setError("Browser notifications are not supported in this browser.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  const exportCsv = () => {
    if (readings.length === 0) {
      setError("No readings available for export.");
      return;
    }

    const metrics = [
      ...new Set(readings.flatMap((entry) => Object.keys(entry))),
    ].sort();
    const headers = ["timestamp_iso", ...metrics];

    const rows = readings.map((entry) => {
      const iso = entry.timestamp
        ? format(fromUnixTime(Number(entry.timestamp)), "yyyy-MM-dd HH:mm:ss")
        : "";
      const values = metrics.map((field) => csvEscape(entry[field] ?? ""));
      return [csvEscape(iso), ...values].join(",");
    });

    const csvContent = `${headers.join(",")}\n${rows.join("\n")}`;
    triggerDownload(
      csvContent,
      `sensor-report-${Date.now()}.csv`,
      "text/csv;charset=utf-8;",
    );
  };

  const exportPdf = async () => {
    if (readings.length === 0) {
      setError("No readings available for export.");
      return;
    }

    try {
      const [{ jsPDF }, autoTableModule] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const autoTable = autoTableModule.default;
      const doc = new jsPDF({ orientation: "landscape" });
      const previewRows = readings.slice(-50).reverse();

      doc.setFontSize(18);
      doc.text("Air Quality Sensor Report", 14, 16);
      doc.setFontSize(11);
      doc.text(
        `Generated: ${format(new Date(), "PPpp")} | Source: ${source}`,
        14,
        24,
      );
      doc.text(
        `Critical: ${alertSummary.red.length} | Watch: ${alertSummary.yellow.length}`,
        14,
        31,
      );

      const headers = [
        "Timestamp",
        "Temperature",
        "Humidity",
        "Pressure",
        "UV",
        "MQ5",
      ];
      const tableBody = previewRows.map((entry) => [
        entry.timestamp
          ? format(fromUnixTime(Number(entry.timestamp)), "PPpp")
          : "--",
        toFixedNumber(entry.temperature),
        toFixedNumber(entry.humidity),
        toFixedNumber(entry.pressure),
        toFixedNumber(entry.uv),
        toFixedNumber(entry.mq5),
      ]);

      autoTable(doc, {
        head: [headers],
        body: tableBody,
        startY: 38,
        styles: {
          fontSize: 9,
          cellPadding: 2,
        },
      });

      doc.save(`sensor-report-${Date.now()}.pdf`);
    } catch {
      setError("PDF export failed. Please try again.");
    }
  };

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Air Quality Command Center</h1>
          <p>
            Source:{" "}
            {source === "firebase-live"
              ? "Firebase (Live)"
              : source === "local-export"
                ? "Export JSON"
                : "Connecting..."}
          </p>
          <p className="auth-subtitle">
            {authReady
              ? authUser
                ? `Signed in as ${authUser.email || authUser.uid}`
                : "Sign in to use live Firebase data"
              : "Checking authentication..."}
          </p>
        </div>
        {latest?.timestamp ? (
          <span>
            Last update: {format(fromUnixTime(latest.timestamp), "PPpp")}
          </span>
        ) : null}
      </header>

      {!authUser ? (
        <section className="auth-panel">
          <h3>Sign In</h3>
          <form className="auth-form" onSubmit={handleSignIn}>
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="Email"
              value={loginForm.email}
              onChange={(event) =>
                setLoginForm((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
              required
            />
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              required
            />
            <button type="submit" disabled={authLoading || !authReady}>
              {authLoading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="toolbar">
        <div className="toolbar-group">
          <button type="button" onClick={exportCsv}>
            Export CSV
          </button>
          <button type="button" onClick={exportPdf}>
            Export PDF
          </button>
        </div>
        <div className="toolbar-group">
          <button type="button" onClick={requestNotifications}>
            {notificationPermission === "granted"
              ? "Notifications Enabled"
              : "Enable Notifications"}
          </button>
          {authUser ? (
            <button
              type="button"
              onClick={handleSignOut}
              disabled={authLoading}
            >
              {authLoading ? "Please wait..." : "Sign Out"}
            </button>
          ) : null}
          <span className="live-pill">Auto-refresh active</span>
        </div>
      </section>

      {authError ? <p className="warning">{authError}</p> : null}
      {error ? <p className="warning">{error}</p> : null}

      <section className="alerts-panel">
        <h3>Alert Status</h3>
        <div className="alerts-row">
          <span className="alert-chip chip-red">
            Critical: {alertSummary.red.length}
          </span>
          <span className="alert-chip chip-yellow">
            Watch: {alertSummary.yellow.length}
          </span>
          <span className="alert-chip chip-green">
            Normal:{" "}
            {sensorCards.length -
              alertSummary.red.length -
              alertSummary.yellow.length}
          </span>
        </div>
      </section>

      <section className="top-section">
        <article className="quality-panel">
          <h3>Real-Time Quality Index</h3>
          <Gauge score={quality.score} label={quality.label} />
        </article>

        {orderedSensorCards.map((card) => (
          <div
            key={card.key}
            className={`sensor-card-slot${draggingCardKey === card.key ? " sensor-card-dragging" : ""}${dragOverCardKey === card.key ? " sensor-card-drop-target" : ""}`}
            draggable
            onDragStart={(event) => handleCardDragStart(event, card.key)}
            onDragOver={(event) => handleCardDragOver(event, card.key)}
            onDrop={(event) => handleCardDrop(event, card.key)}
            onDragEnd={handleCardDragEnd}
          >
            {card.kind === "group" ? (
              <SensorGroupCard
                title={card.title}
                status={card.status}
                rows={card.rows}
              />
            ) : (
              <SensorCard
                metric={card.metric}
                value={card.value}
                status={card.status}
                sparklineData={card.sparklineData}
              />
            )}
          </div>
        ))}
      </section>

      <section className="charts-grid">
        <article className="chart-card chart-card-wide">
          <h3>Live Trend (Last 1h)</h3>
          {liveTrendData.length === 0 ? (
            <p className="chart-empty">Insufficient real-time data available</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={liveTrendData}>
                <CartesianGrid strokeDasharray="2 4" stroke="#2d4473" />
                <XAxis dataKey="timestamp" stroke="#b8c6e3" />
                <YAxis stroke="#b8c6e3" />
                <Tooltip />
                <Legend />
                {trendMetrics.map((metric, index) => (
                  <Line
                    key={`live-${metric}`}
                    dataKey={metric}
                    stroke={
                      TREND_COLOR_PALETTE[index % TREND_COLOR_PALETTE.length]
                    }
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name={`${formatMetricName(metric)}${UNIT_BY_METRIC[metric] ? ` (${UNIT_BY_METRIC[metric]})` : ""}`}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </article>
        <article className="chart-card">
          <h3>Daily Trend (24h)</h3>
          {dailySeries.length === 0 ? (
            <p className="chart-empty">Insufficient data available</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={dailySeries}>
                <CartesianGrid strokeDasharray="2 4" stroke="#2d4473" />
                <XAxis dataKey="label" stroke="#b8c6e3" />
                <YAxis stroke="#b8c6e3" />
                <Tooltip />
                <Legend />
                {trendMetrics.map((metric, index) => (
                  <Line
                    key={`day-${metric}`}
                    dataKey={metric}
                    stroke={
                      TREND_COLOR_PALETTE[index % TREND_COLOR_PALETTE.length]
                    }
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name={`${formatMetricName(metric)}${UNIT_BY_METRIC[metric] ? ` (${UNIT_BY_METRIC[metric]})` : ""}`}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </article>

        <article className="chart-card">
          <h3>Weekly Trend (7d)</h3>
          {weeklySeries.length === 0 ? (
            <p className="chart-empty">Insufficient data available</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={weeklySeries}>
                <CartesianGrid strokeDasharray="2 4" stroke="#2d4473" />
                <XAxis dataKey="label" stroke="#b8c6e3" />
                <YAxis stroke="#b8c6e3" />
                <Tooltip />
                <Legend />
                {trendMetrics.map((metric, index) => (
                  <Line
                    key={`week-${metric}`}
                    dataKey={metric}
                    stroke={
                      TREND_COLOR_PALETTE[index % TREND_COLOR_PALETTE.length]
                    }
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name={`${formatMetricName(metric)}${UNIT_BY_METRIC[metric] ? ` (${UNIT_BY_METRIC[metric]})` : ""}`}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </article>
      </section>
    </main>
  );
}

export default App;
