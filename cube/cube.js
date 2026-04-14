const http = require('http');

const fetchConn = (connId) => {
  return new Promise((resolve, reject) => {
    const path = connId ? `/connections/${connId}/credentials` : `/connections/latest/credentials`;
    const req = http.get(`http://backend:8000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch connection: ${res.statusCode} - ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
};

const fetchModels = (connId) => {
  return new Promise((resolve, reject) => {
    const path = connId ? `/connections/${connId}/cube-models/internal` : `/connections/latest/cube-models/internal`;
    const req = http.get(`http://backend:8000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch models: ${res.statusCode} - ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
};

module.exports = {
  checkAuth: (req, auth) => {
    req.securityContext = {
      conn_id: req.headers['x-cube-conn-id'] || null
    };
  },
  driverFactory: async ({ securityContext }) => {
    const connId = securityContext?.conn_id;
    const credsAndProject = await fetchConn(connId);
    
    return {
      type: 'bigquery',
      projectId: credsAndProject.project_id,
      credentials: credsAndProject.credentials
    };
  },
  repositoryFactory: ({ securityContext }) => ({
    dataSchemaFiles: async () => {
      const connId = securityContext?.conn_id;
      const models = await fetchModels(connId);
      return models.map(m => ({
        fileName: m.fileName,
        content: m.content
      }));
    }
  })
};
