import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installSlugAwareFetch } from './satellitePath'
import './index.css'

installSlugAwareFetch()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
