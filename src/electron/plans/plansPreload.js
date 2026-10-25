'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Dedicated bridge for the QuotaTray subscription-plans panel. Kept
// separate from the main tokenMonitor bridge so the plans surface stays
// default-deny: it can only reach the quotatray:plans:* channels.
contextBridge.exposeInMainWorld('quotaTrayPlans', {
  getState: () => ipcRenderer.invoke('quotatray:plans:getState'),
  savePlan: (plan) => ipcRenderer.invoke('quotatray:plans:save', plan),
  deletePlan: (planId) => ipcRenderer.invoke('quotatray:plans:delete', planId),
  adjustPlan: (planId, delta) => ipcRenderer.invoke('quotatray:plans:adjust', planId, delta),
  open: () => ipcRenderer.invoke('quotatray:plans:open')
});
