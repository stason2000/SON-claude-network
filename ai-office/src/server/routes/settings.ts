import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { getSafetyLimits, saveSafetyLimits } from '../repo/settings.js';
import type { SafetyLimits } from '../../shared/types.js';

export function registerSettingsRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/settings/limits', async () => getSafetyLimits(db));

  app.put<{ Body: SafetyLimits }>(
    '/api/settings/limits',
    {
      schema: {
        body: {
          type: 'object',
          required: ['maxTaskMinutes', 'maxIterations', 'maxCostUsdPerTask', 'maxCostUsdPerDay'],
          additionalProperties: false,
          properties: {
            maxTaskMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
            maxIterations: { type: 'integer', minimum: 1, maximum: 50 },
            maxCostUsdPerTask: { type: 'number', minimum: 0, maximum: 1000 },
            maxCostUsdPerDay: { type: 'number', minimum: 0, maximum: 10000 },
          },
        },
      },
    },
    async (req) => saveSafetyLimits(db, req.body),
  );
}
