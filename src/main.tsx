import "./i18n" // initialise i18n before anything renders
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./app"
import "./app/globals.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
