import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import NewGame from "./pages/NewGame";
import Workspace from "./pages/Workspace";
import Tactical from "./pages/Tactical";
import Scouting from "./pages/Scouting";
import Clips from "./pages/Clips";
import Stats from "./pages/Stats";
import SettingsPage from "./pages/Settings";
import Report from "./pages/Report";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="novo" element={<NewGame />} />
        <Route path="jogo/:id" element={<Workspace />} />
        <Route path="tatica" element={<Tactical />} />
        <Route path="scouting" element={<Scouting />} />
        <Route path="clips" element={<Clips />} />
        <Route path="estatisticas" element={<Stats />} />
        <Route path="relatorio" element={<Report />} />
        <Route path="definicoes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
