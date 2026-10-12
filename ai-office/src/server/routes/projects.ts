import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { createProject, getProject, listProjects, updateProject } from '../repo/projects.js';
import { listTasks } from '../repo/tasks.js';
import { PROJECT_STATUSES, type ProjectStatus } from '../../shared/types.js';

const nameProp = { type: 'string', minLength: 1, maxLength: 80 } as const;
const descProp = { type: 'string', maxLength: 2000 } as const;
const pathProp = { type: ['string', 'null'], maxLength: 500 } as const;

export function registerProjectRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { status?: ProjectStatus } }>(
    '/api/projects',
    { schema: { querystring: { type: 'object', properties: { status: { enum: PROJECT_STATUSES } } } } },
    async (req) => ({ items: listProjects(db, req.query.status) }),
  );

  app.post<{ Body: { name: string; description?: string; workspacePath?: string | null } }>(
    '/api/projects',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: nameProp, description: descProp, workspacePath: pathProp },
        },
      },
    },
    async (req, reply) => reply.code(201).send(createProject(db, req.body)),
  );

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const project = getProject(db, req.params.id);
    return { ...project, tasks: listTasks(db, { projectId: project.id, limit: 200, offset: 0 }).items };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string; workspacePath?: string | null; status?: ProjectStatus } }>(
    '/api/projects/:id',
    {
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: { name: nameProp, description: descProp, workspacePath: pathProp, status: { enum: PROJECT_STATUSES } },
        },
      },
    },
    async (req) => updateProject(db, req.params.id, req.body),
  );
}
