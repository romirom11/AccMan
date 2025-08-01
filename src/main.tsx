import React from "react"
import ReactDOM from "react-dom/client"
import App from "./app"
import "./app/globals.css"
import "./i18n"; // Import the i18n configuration

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
