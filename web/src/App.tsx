import { useEffect, useState } from "react";
import { useHashRoute } from "./hooks";
import { getHealth } from "./api";
import type { Health } from "./types";
import { Ask } from "./pages/Ask";
import { Questions } from "./pages/Questions";
import { QuestionDetail } from "./pages/QuestionDetail";
import { Leaderboard } from "./pages/Leaderboard";
import { Providers } from "./pages/Providers";
import { Calibration } from "./pages/Calibration";
import "./styles.css";

const LINKS = [
  { path: "/", label: "Ask" },
  { path: "/questions", label: "Questions" },
  { path: "/leaderboard", label: "Leaderboard" },
  { path: "/providers", label: "Providers" },
  { path: "/calibration", label: "Calibration" },
];

function TopBar() {
  const route = useHashRoute();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    getHealth()
      .then((h) => alive && setHealth(h))
      .catch(() => alive && setHealth(null));
    const t = setInterval(() => {
      getHealth()
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth(null));
    }, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const isActive = (path: string) =>
    path === "/" ? route === "/" || route === "" : route.startsWith(path);

  const connectedProviders = health?.providers?.filter((p) => p.connected).length ?? 0;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#/">
          <span className="brand-mark">Δ</span>
          DELPHI
        </a>
        <nav className="navlinks">
          {LINKS.map((l) => (
            <a key={l.path} href={`#${l.path}`} className={isActive(l.path) ? "active" : ""}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="health-pill" title={health ? `v${health.version}` : "backend unreachable"}>
          <span className={`health-dot${health ? "" : " down"}`} />
          {health
            ? `${connectedProviders}/${health.providers.length} providers${health.demoMode ? " · demo" : ""}`
            : "api down"}
        </div>
      </div>
    </header>
  );
}

function Router() {
  const route = useHashRoute();

  if (route.startsWith("/questions/")) {
    const id = decodeURIComponent(route.slice("/questions/".length));
    return <QuestionDetail key={id} id={id} />;
  }
  if (route === "/questions") return <Questions />;
  if (route === "/leaderboard") return <Leaderboard />;
  if (route === "/providers") return <Providers />;
  if (route === "/calibration") return <Calibration />;
  return <Ask />;
}

export default function App() {
  return (
    <div className="app">
      <TopBar />
      <main>
        <Router />
      </main>
      <footer className="footer">
        DELPHI · council-based forecasting · logarithmic opinion pool
      </footer>
    </div>
  );
}
