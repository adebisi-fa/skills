---
name: evtstore-quickstart
description: Start here to build your first evtstore-backed feature quickly in TypeScript/Node.js.
license: MIT
metadata:
  author: Foluso ADEBISI
  version: '0.5'
---

Use this skill when you want the shortest path to a working evtstore feature in a TypeScript/Node.js backend.

Choose this skill when you need:

- a fast first implementation
- one end-to-end example to copy from
- minimal theory and only the core workflow

Use `evtstore-reference` instead when you need deeper guidance on projections, handler options, provider choices, persistence, testing, or advanced patterns.

## Goal

Build one small event-sourced feature end to end:

- define `Evt`, `Agg`, and `Cmd` types
- create an aggregate with `createAggregate(...)`
- create commands with `createCommands(...)`
- register the aggregate in `createDomain(...)`
- project events into a read model
- query the read model

Official references:

- https://seikho.github.io/evtstore/
- https://seikho.github.io/evtstore/#/docs/api
- https://seikho.github.io/evtstore/#/docs/commands
- https://seikho.github.io/evtstore/#/docs/event-handlers

## Mental Model

`evtstore` usually fits a CQRS + event sourcing architecture:

- commands validate intent and emit events
- aggregates fold events into current state
- projections turn events into queryable read models

Typical flow:

1. call a command
2. validate the current aggregate state
3. emit one or more events
4. fold events into the aggregate
5. update a projection
6. query the projection

## Install

```bash
npm install evtstore mongodb
```

## Step 1: Define Types

Start with event, aggregate, and command types.

```ts
export type DepartmentEvt =
	| {
			type: 'departmentCreated';
			tenantId: string;
			name: string;
			description?: string;
			dataContext: 'live' | 'test';
			performedBy?: string;
	  }
	| {
			type: 'departmentUpdated';
			name?: string;
			description?: string;
			performedBy?: string;
	  }
	| {
			type: 'departmentDeleted';
			deletedBy?: string;
	  };

export type DepartmentAgg = {
	tenantId?: string;
	name: string;
	description?: string;
	dataContext: 'live' | 'test';
	deleted?: boolean;
	deletedBy?: string;
};

export type DepartmentCmd =
	| {
			type: 'create';
			tenantId: string;
			name: string;
			description?: string;
			dataContext: 'live' | 'test';
			performedBy?: string;
	  }
	| {
			type: 'update';
			name?: string;
			description?: string;
			performedBy?: string;
	  }
	| {
			type: 'delete';
			deletedBy?: string;
	  };
```

Guidelines:

- use past-tense names for events
- keep command names intention-based
- keep aggregate state focused on current business state

## Step 2: Create the Aggregate

Use a literal stream name for better type inference.

```ts
import { createAggregate } from 'evtstore';

export const departmentAgg = createAggregate<DepartmentEvt, DepartmentAgg, 'departments'>({
	stream: 'departments',
	create: (): DepartmentAgg => ({
		tenantId: '',
		name: '',
		description: '',
		dataContext: 'test',
		deleted: false
	}),
	fold: (evt, prev) => {
		switch (evt.type) {
			case 'departmentCreated':
				return {
					...prev,
					tenantId: evt.tenantId,
					name: evt.name,
					description: evt.description || '',
					dataContext: evt.dataContext,
					deleted: false,
					deletedBy: undefined
				};
			case 'departmentUpdated':
				return {
					...prev,
					name: evt.name ?? prev.name,
					description: evt.description ?? prev.description
				};
			case 'departmentDeleted':
				return {
					...prev,
					deleted: true,
					deletedBy: evt.deletedBy
				};
			default:
				return prev;
		}
	}
});
```

Rules:

- keep `fold` pure
- do not mutate arrays or objects in place
- prefer `...prev` in examples unless you deliberately rely on partial merge behavior

Official references:

- https://seikho.github.io/evtstore/#/docs/api?id=createaggregate
- https://seikho.github.io/evtstore/#/docs/multiple-streams

## Step 3: Create the Domain

Register your aggregates in one domain and wire a provider.

```ts
import { createDomain } from 'evtstore';
import { type Bookmark, createProvider, migrate } from 'evtstore/provider/mongo';
import { MongoClient } from 'mongodb';
import type { Provider, StoreEvent } from 'evtstore';

export type Event = DepartmentEvt;

async function getMongoProvider(): Promise<Provider<Event>> {
	const mongoUri = process.env.MONGO_URI;
	if (!mongoUri) throw new Error('MongoDB connection not configured');

	const client = await MongoClient.connect(mongoUri);
	const events = client.db().collection<StoreEvent<Event>>('events');
	const bookmarks = client.db().collection<Bookmark>('bookmarks');

	const provider = createProvider({ limit: 1000, events, bookmarks });
	await migrate(events, bookmarks);
	return provider;
}

const provider = await getMongoProvider();

export const { domain, createHandler } = createDomain({ provider }, { departments: departmentAgg });
```

Official references:

- https://seikho.github.io/evtstore/#/docs/api?id=createdomain
- https://seikho.github.io/evtstore/#/docs/providers?id=mongodb

## Step 4: Create Commands

```ts
import { createCommands } from 'evtstore';
import { domain } from '../domain';

export const departmentCmd = createCommands<DepartmentEvt, DepartmentAgg, DepartmentCmd>(
	domain.departments,
	{
		async create(cmd, agg) {
			if (agg.version) throw new Error('Department already exists');

			return {
				type: 'departmentCreated',
				tenantId: cmd.tenantId,
				name: cmd.name,
				description: cmd.description,
				dataContext: cmd.dataContext,
				performedBy: cmd.performedBy
			};
		},

		async update(cmd, agg) {
			if (!agg.version) throw new Error('Department not found');
			if (agg.deleted) throw new Error('Department is deleted');

			const changed =
				(cmd.name !== undefined && cmd.name != agg.name) ||
				(cmd.description !== undefined && cmd.description != agg.description);

			if (!changed) return [];

			return {
				type: 'departmentUpdated',
				name: cmd.name,
				description: cmd.description,
				performedBy: cmd.performedBy
			};
		},

		async delete(cmd, agg) {
			if (!agg.version) throw new Error('Department not found');
			if (agg.deleted) throw new Error('Department already deleted');

			return {
				type: 'departmentDeleted',
				deletedBy: cmd.deletedBy
			};
		}
	}
);
```

Important runtime rule:

- do not pass `type` when invoking command methods
- the method name already selects the command

Correct:

```ts
await departmentCmd.create('department-123', {
	tenantId: 'tenant-1',
	name: 'Engineering',
	description: 'Engineering team',
	dataContext: 'live',
	performedBy: '08012345678'
});
```

Wrong:

```ts
await departmentCmd.create('department-123', {
	type: 'create',
	tenantId: 'tenant-1',
	name: 'Engineering',
	dataContext: 'live'
});
```

Official references:

- https://seikho.github.io/evtstore/#/docs/commands
- https://seikho.github.io/evtstore/#/docs/commands?id=invoking
- https://seikho.github.io/evtstore/#/docs/api?id=createcommands

## Step 5: Add a Projection

```ts
import { createHandler } from './domain';
import { getMongoClient } from './projection-shared';

export interface DepartmentProjection {
	departmentId: string;
	tenantId: string;
	name: string;
	description: string;
	dataContext: 'live' | 'test';
	deleted: boolean;
	deletedBy?: string;
	createdAt: string;
	updatedAt: string;
}

const departmentsModel = createHandler('departments-model', ['departments']);

departmentsModel.handle('departments', 'departmentCreated', async (id, event, meta) => {
	const client = await getMongoClient();
	await client
		.db()
		.collection<DepartmentProjection>('departments')
		.replaceOne(
			{ departmentId: id },
			{
				departmentId: id,
				tenantId: event.tenantId,
				name: event.name,
				description: event.description || '',
				dataContext: event.dataContext,
				deleted: false,
				createdAt: meta.timestamp.toISOString(),
				updatedAt: meta.timestamp.toISOString()
			},
			{ upsert: true }
		);
});

departmentsModel.handle('departments', 'departmentUpdated', async (id, event, meta) => {
	const client = await getMongoClient();
	await client
		.db()
		.collection<DepartmentProjection>('departments')
		.updateOne(
			{ departmentId: id },
			{
				$set: {
					updatedAt: meta.timestamp.toISOString(),
					...(event.name !== undefined ? { name: event.name } : {}),
					...(event.description !== undefined ? { description: event.description } : {})
				}
			}
		);
});

departmentsModel.handle('departments', 'departmentDeleted', async (id, event, meta) => {
	const client = await getMongoClient();
	await client
		.db()
		.collection<DepartmentProjection>('departments')
		.updateOne(
			{ departmentId: id },
			{
				$set: {
					deleted: true,
					deletedBy: event.deletedBy,
					updatedAt: meta.timestamp.toISOString()
				}
			}
		);
});
```

Projection rules:

- use `handle(stream, eventType, handler)`
- use `meta.timestamp`
- start handlers during bootstrap with `model.start()`

Official references:

- https://seikho.github.io/evtstore/#/docs/event-handlers
- https://seikho.github.io/evtstore/#/docs/event-handlers?id=handleroptions

## Step 6: Add Queries

```ts
import type { WithId } from 'mongodb';

function cleanDoc<T>(doc: WithId<T> | null): T | null {
	if (!doc) return null;
	const { _id: _, ...rest } = doc;
	return rest as T;
}

export const queryDepartments = {
	getById: async (id: string): Promise<DepartmentProjection | null> => {
		const client = await getMongoClient();
		const doc = await client
			.db()
			.collection<DepartmentProjection>('departments')
			.findOne({ departmentId: id });
		return cleanDoc(doc as WithId<DepartmentProjection> | null);
	}
};
```

## First Feature Checklist

1. define `Evt`, `Agg`, and `Cmd`
2. create the aggregate
3. register it in the domain
4. create commands
5. create one projection
6. create one query module
7. invoke commands without runtime `type`
8. bootstrap projections with `start()`

## When to Use the Reference Skill

Use `evtstore-reference` when you need:

- aggregate persistence
- domain cache
- multi-stream handlers
- handler lifecycle details like `runOnce()` and `reset()`
- provider alternatives beyond MongoDB
- testing and anti-pattern guidance
