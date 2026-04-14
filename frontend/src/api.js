import axios from "axios";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({ baseURL: BASE });

export const createConnection = (data) => api.post("/connections", data);
export const listConnections = () => api.get("/connections");
export const deleteConnection = (id) => api.delete(`/connections/${id}`);
export const testConnection = (id) => api.post(`/connections/${id}/test`);
export const testCubeConnection = (id) => api.post(`/connections/${id}/test-cube`);
export const getDatasets = (id) => api.get(`/connections/${id}/datasets`);
export const syncDatasets = (id) => api.post(`/connections/${id}/datasets/sync`);
export const getTables = (id, dataset) =>
  api.get(`/connections/${id}/datasets/${dataset}/tables`);
export const getModels = (id) => api.get(`/connections/${id}/models`);
export const updateDefinition = (id, business_definition) =>
  api.patch(`/connections/${id}/definition`, { business_definition });

// Table metadata
const tbl = (connId, dsId, tblId) =>
  `/connections/${connId}/datasets/${dsId}/tables/${tblId}`;
export const getTableMeta    = (connId, dsId, tblId) => api.get(`${tbl(connId, dsId, tblId)}/meta`);
export const upsertTableMeta = (connId, dsId, tblId, data) => api.put(`${tbl(connId, dsId, tblId)}/meta`, data);
export const syncTableSchema = (connId, dsId, tblId) => api.post(`${tbl(connId, dsId, tblId)}/meta/sync-schema`);
export const generateColumnDefs = (connId, dsId, tblId) => api.post(`${tbl(connId, dsId, tblId)}/meta/generate-columns`);
export const generateTableMetrics = (connId, dsId, tblId) => api.post(`${tbl(connId, dsId, tblId)}/meta/generate-metrics`);
export const generateCubeModel = (connId, dsId, tblId) => api.post(`${tbl(connId, dsId, tblId)}/meta/generate-cube-model`);
export const updateColumnAiDefinition = (connId, dsId, tblId, colName, aiDesc) => 
  api.put(`${tbl(connId, dsId, tblId)}/meta/columns/${colName}`, { ai_description: aiDesc });
export const updateMetrics = (connId, dsId, tblId, metrics) =>
  api.put(`${tbl(connId, dsId, tblId)}/meta/metrics`, { metrics });
export const updateCubeModel = (connId, dsId, tblId, cubeModel) =>
  api.put(`${tbl(connId, dsId, tblId)}/meta/cube-model`, { cube_model: cubeModel });
