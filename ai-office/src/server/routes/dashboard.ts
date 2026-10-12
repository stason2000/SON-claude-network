import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { countActiveProjects } from '../repo/projects.js';
import { countByStatus, listEvents, listTasks } from '../repo/tasks.js';
import type { DashboardData } from '../../shared/types.js';

export function registerDashboardRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/dashboard', async (): Promise<DashboardData> => {
    const taskCounts = countByStatus(db);
    return {
      taskCounts,
      totalTasks: Object.values(taskCounts).reduce((a, b) => a + b, 0),
      activeProjects: countActiveProjects(db),
      recentTasks: listTasks(db, { limit: 8, offset: 0 }).items,
      recentEvents: listEvents(db, 10, 0).items,
    };
  });
}
