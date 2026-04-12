// api/index.js — Adapter Vercel Serverless para o Express (Vértice API)
// Este arquivo é o entry point para o runtime @vercel/node.
// Ele importa o app Express já configurado e o exporta para que
// a Vercel possa chamá-lo como uma serverless function.

const app = require('../vertice-backend/src/index');

module.exports = app;
