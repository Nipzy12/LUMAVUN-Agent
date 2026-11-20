'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumavun', Object.freeze({
  load: () => ipcRenderer.invoke('app:load'),
  save: state => ipcRenderer.invoke('app:save', state),
  saveProvider: config => ipcRenderer.invoke('provider:save', config),
  models: () => ipcRenderer.invoke('provider:models'),
  chat: request => ipcRenderer.invoke('provider:chat', request),
  cancel: id => ipcRenderer.invoke('provider:cancel', id),
  generateImage: request => ipcRenderer.invoke('provider:image', request),
  readImage: id => ipcRenderer.invoke('provider:read-image', id),
  exportData: () => ipcRenderer.invoke('app:export'),
  importData: () => ipcRenderer.invoke('app:import'),
  openExternal: url => ipcRenderer.invoke('app:external', url),
  version: () => ipcRenderer.invoke('app:version')
}));
