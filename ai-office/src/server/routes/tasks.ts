import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { addTaskNote, createTask, getTask, listEvents, listTasks, transitionTask } from '../repo/tasks.js';
import {
  DEPARTMENTS,
  PRIORITIES,
  TASK_STATUSES,
  type Department,
  type Priority,
  type TaskStatus,
} from '../../shared/types.js';

const pageQuery = {
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  offset: { type: 'integer', minimum: 0, default: 0 },
} as const;

export function registerTaskRoutes(app: FastifyInstance, db: Db): void {
  app.get<{
    Querystring: { status?: TaskStatus; department?: Department; projectId?: string; limit: number; offset: number };
  }>(
    '/api/tasks',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { enum: TASK_STATUSES },
            department: { enum: DEPARTMENTS },
            projectId: { type: 'string', maxLength: 64 },
            ...pageQuery,
          },
        },
      },
    },
    async (req) => {
      const { status, department, projectId, limit, offset } = req.query;
      return listTasks(db, {
        ...(status ? { status } : {}),
        ...(department ? { department } : {}),
        ...(projectId ? { projectId } : {}),
        limit,
        offset,
      });
    },
  );

  app.post<{
    Body: { title?: string; goal: string; department: Department; projectId?: string | null; priority?: Priority };
  }>(
    '/api/tasks',
    {
      schema: {
        body: {
          type: 'object',
          required: ['goal', 'department'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', maxLength: 120 },
            goal: { type: 'string', minLength: 1, maxLength: 8000 },
            department: { enum: DEPARTMENTS },
            projectId: { type: ['string', 'null'], maxLength: 64 },
            priority: { enum: PRIORITIES },
          },
        },
      },
    },
    async (req, reply) => reply.code(201).send(createTask(db, req.body)),
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req) => getTask(db, req.params.id));

  app.post<{ Params: { id: string }; Body: { to: TaskStatus; message?: string } }>(
    '/api/tasks/:id/transition',
    {
      schema: {
        body: {
          type: 'object',
          required: ['to'],
          additionalProperties: false,
          properties: { to: { enum: TASK_STATUSES }, message: { type: 'string', maxLength: 1000 } },
        },
      },
    },
    async (req) => transitionTask(db, req.params.id, req.body.to, req.body.message ?? ''),
  );

  app.post<{ Params: { id: string }; Body: { message: string } }>(
    '/api/tasks/:id/notes',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          additionalProperties: false,
          properties: { message: { type: 'string', minLength: 1, maxLength: 1000 } },
        },
      },
    },
    async (req, reply) => reply.code(201).send(addTaskNote(db, req.params.id, req.body.message)),
  );

  app.get<{ Querystring: { limit: number; offset: number } }>(
    '/api/events',
    { schema: { querystring: { type: 'object', properties: pageQuery } } },
    async (req) => listEvents(db, req.query.limit, req.query.offset),
  );
}
