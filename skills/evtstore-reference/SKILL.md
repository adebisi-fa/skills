---
name: evtstore-reference
description: Use this detailed reference when you need the full evtstore toolbox for TypeScript/Node.js backends.
license: MIT
metadata:
  author: Foluso ADEBISI
  version: '0.5'
---

Use this skill when building or extending backend features with `evtstore` in a TypeScript/Node.js project and you need deeper implementation guidance.

Choose this skill when you need:

- a full reference for aggregates, commands, projections, and queries
- advanced topics like aggregate persistence, domain cache, and multi-stream handlers
- detailed handler lifecycle, provider, testing, and anti-pattern guidance

Use `evtstore-quickstart` instead when you want a compact first-feature walkthrough.

## Outcome

By the end, you should be able to:

- model domain events, commands, and aggregate state
- implement aggregates with `createAggregate(...)`
- implement command handlers with `createCommands(...)`
- set up a domain with `createDomain(...)`
- persist events in MongoDB
- project events into read models
- expose query functions against projection collections

## Mental Model

`evtstore` is typically used in a CQRS + event sourcing setup.

- write side: commands validate intent and emit events
- state side: aggregates fold events into current state
- read side: projections turn events into query-friendly documents

Typical flow:

1. client or server code calls a command
2. command validates current aggregate state
3. command emits one or more events
4. aggregate state is rebuilt by folding events
5. projection handlers consume those events and update read models
6. queries read from projection collections, not from aggregate streams

Official references:

- https://seikho.github.io/evtstore/

## Recommended Project Structure

This structure is flexible, but a clean baseline is:

```text
src/
  backend/
    es/
      aggregates/
      command/
      types/
      domain.ts
      projection.ts
      projection-shared.ts
      queries.ts
      shared.ts
```

For a new aggregate `department`, you will often add:

- `types/department.ts`
- `aggregates/department.ts`
- `command/department.ts`
- updates in `domain.ts`
- projection handlers in `projection.ts`
- read model types in `projection-shared.ts`
- query helpers in `queries.ts`

## Installation

```bash
npm install evtstore mongodb
```

If your commands need hashing, validation, or IDs, add those separately:

```bash
npm install bcrypt uuid zod
```

## Core Types

Each aggregate usually has three core types.

### Event type

Use discriminated unions with past-tense event names.

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
			type: 'departmentManagerAdded';
			userPhone: string;
			performedBy?: string;
	  }
	| {
			type: 'departmentManagerRemoved';
			userPhone: string;
			performedBy?: string;
	  }
	| {
			type: 'departmentDeleted';
			deletedBy?: string;
	  };
```

### Aggregate state type

This is the reconstructed current state.

```ts
export type DepartmentAgg = {
	tenantId?: string;
	name: string;
	managers: string[];
	description?: string;
	dataContext: 'live' | 'test';
	deleted?: boolean;
	deletedBy?: string;
};
```

### Command type

Keep command names intention-based.

```ts
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
			type: 'addManager';
			userPhone: string;
			performedBy?: string;
	  }
	| {
			type: 'removeManager';
			userPhone: string;
			performedBy?: string;
	  }
	| {
			type: 'delete';
			deletedBy?: string;
	  };
```

## Aggregate Implementation

Define aggregates with `createAggregate(...)`.

Official references:

- https://seikho.github.io/evtstore/#/docs/api
- https://seikho.github.io/evtstore/#/docs/api?id=createaggregate

```ts
import { createAggregate } from 'evtstore';
import type { DepartmentEvt, DepartmentAgg } from '../types/department';

export const departmentAgg = createAggregate<DepartmentEvt, DepartmentAgg, 'departments'>({
	stream: 'departments',
	create: (): DepartmentAgg => ({
		tenantId: '',
		name: '',
		managers: [],
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
					managers: [],
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

			case 'departmentManagerAdded':
				return {
					...prev,
					managers: [...prev.managers, evt.userPhone]
				};

			case 'departmentManagerRemoved':
				return {
					...prev,
					managers: prev.managers.filter((phone) => phone !== evt.userPhone)
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

### Fold rules

- keep fold functions pure
- never mutate arrays or objects in place
- prefer `...prev` unless you are certain your evtstore setup merges partial results as expected
- use helper functions if nested structures get noisy

### Stream literal guidance

Pass the stream name as a string literal generic when creating an aggregate:

```ts
createAggregate<DepartmentEvt, DepartmentAgg, 'departments'>(...)
```

This improves TypeScript inference for `createHandler(...)` and helps evtstore narrow valid streams and event types.

Official references:

- https://seikho.github.io/evtstore/#/docs/api?id=createaggregate
- https://seikho.github.io/evtstore/#/docs/multiple-streams

### Aggregate persistence

`evtstore` supports persisted aggregate snapshots via `createAggregate({ version, persistAggregate })`.

Example:

```ts
export const departmentAgg = createAggregate<DepartmentEvt, DepartmentAgg, 'departments'>({
	stream: 'departments',
	create: () => ({ tenantId: '', name: '', managers: [], description: '', dataContext: 'test' }),
	fold,
	version: '1',
	persistAggregate: true
});
```

Use this only when aggregate hydration cost is high and you need the optimization.

Important warning:

- if you change `fold`, bump `version`
- if you forget to bump `version`, evtstore may reuse a persisted aggregate built with old fold logic
- that can produce stale or incorrect state

Safe default: do not enable aggregate persistence until you actually need it.

Official references:

- https://seikho.github.io/evtstore/#/docs/api?id=aggregate-persistence

## Domain Setup

Set up the provider and register all aggregates in one domain.

Official references:

- https://seikho.github.io/evtstore/#/docs/api
- https://seikho.github.io/evtstore/#/docs/api?id=createdomain

```ts
import { createDomain } from 'evtstore';
import { type Bookmark, createProvider, migrate } from 'evtstore/provider/mongo';
import { createEventsMapper } from 'evtstore/provider/util';
import { MongoClient, Timestamp } from 'mongodb';
import type { Provider, StoreEvent } from 'evtstore';
import { departmentAgg } from './aggregates/department';
import { userAccountAgg } from './aggregates/user-account';

export type Event = DepartmentEvt | UserAccountEvt;

const LIMIT = 1000;
let providerPromise: Promise<Provider<Event>> | undefined;

async function getMongoProvider(): Promise<Provider<Event>> {
	if (!providerPromise) {
		providerPromise = (async () => {
			const mongoUri = process.env.MONGO_URI;
			if (!mongoUri) throw new Error('MongoDB connection not configured');

			const client = await MongoClient.connect(mongoUri);
			const events = client.db().collection<StoreEvent<Event>>('events');
			const bookmarks = client.db().collection<Bookmark>('bookmarks');

			const provider = createProvider({
				limit: LIMIT,
				events,
				bookmarks
			});

			await migrate(events, bookmarks);
			return provider;
		})();
	}

	return providerPromise;
}

const createEvents = createEventsMapper<Event>(new Timestamp({ t: 0, i: 0 }));

const providerInstance: Provider<Event> = {
	limit: LIMIT,
	driver: 'mongo',
	onError: () => {},
	getPosition: async (bookmark) => (await getMongoProvider()).getPosition(bookmark),
	setPosition: async (bookmark, position) =>
		(await getMongoProvider()).setPosition(bookmark, position),
	getEventsFrom: async (stream, position, limit) =>
		(await getMongoProvider()).getEventsFrom(stream, position, limit),
	getEventsFor: async (stream, aggregateId, fromPosition) =>
		(await getMongoProvider()).getEventsFor(stream, aggregateId, fromPosition),
	getLastEventFor: async (stream, aggregateId) =>
		(await getMongoProvider()).getLastEventFor(stream, aggregateId),
	createEvents,
	append: async (stream, aggregateId, version, event) =>
		(await getMongoProvider()).append(stream, aggregateId, version, event)
};

export const { domain, createHandler } = createDomain(
	{ provider: providerInstance },
	{
		departments: departmentAgg,
		userAccounts: userAccountAgg
	}
);
```

### Domain rules

- keep a single union `Event` for registered aggregate events
- add each new aggregate to the domain map
- make provider initialization lazy and reusable
- fail fast if `MONGO_URI` is missing

### Domain cache

`createDomain(...)` supports `useCache`:

```ts
export const { domain, createHandler } = createDomain(
	{ provider: providerInstance, useCache: true },
	{ departments: departmentAgg, userAccounts: userAccountAgg }
);
```

Use it as a performance optimization when aggregate reload cost matters. Treat it as an optimization, not a replacement for good modeling.

Official references:

- https://seikho.github.io/evtstore/#/docs/api?id=createdomain

## Commands

Define command handlers with `createCommands(...)`.

Official references:

- https://seikho.github.io/evtstore/#/docs/commands
- https://seikho.github.io/evtstore/#/docs/api?id=createcommands

```ts
import { createCommands } from 'evtstore';
import type { DepartmentEvt, DepartmentAgg, DepartmentCmd } from '../types/department';
import { domain } from '../domain';

function normalizePhone(input: string) {
	return input.trim();
}

function getChangedFields<T extends object>(
	input: T,
	current: Record<string, unknown>,
	fields: Array<keyof T>
) {
	const changes: Record<string, unknown> = {};
	for (const field of fields) {
		const next = input[field];
		if (next !== undefined && next !== current[field as string]) {
			changes[field as string] = next;
		}
	}
	return changes;
}

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

			const changes = getChangedFields(cmd, agg, ['name', 'description']);
			if (Object.keys(changes).length === 0) return [];

			return {
				...changes,
				type: 'departmentUpdated',
				performedBy: cmd.performedBy
			} as DepartmentEvt;
		},

		async addManager(cmd, agg) {
			if (!agg.version) throw new Error('Department not found');
			if (agg.deleted) throw new Error('Department is deleted');

			const normalizedPhone = normalizePhone(cmd.userPhone);
			if (agg.managers.includes(normalizedPhone)) {
				throw new Error('User is already a manager');
			}

			return {
				type: 'departmentManagerAdded',
				userPhone: normalizedPhone,
				performedBy: cmd.performedBy
			};
		},

		async removeManager(cmd, agg) {
			if (!agg.version) throw new Error('Department not found');
			if (agg.deleted) throw new Error('Department is deleted');

			const normalizedPhone = normalizePhone(cmd.userPhone);
			if (!agg.managers.includes(normalizedPhone)) {
				throw new Error('User is not a manager');
			}

			return {
				type: 'departmentManagerRemoved',
				userPhone: normalizedPhone,
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

### Important command invocation rule

The method name selects the command. Do not pass `type` in the payload.

Correct:

```ts
await departmentCmd.create('department-123', {
	tenantId: 'tenant-1',
	name: 'Engineering',
	description: 'Engineering team',
	dataContext: 'live',
	performedBy: '08012345678'
});

await departmentCmd.addManager('department-123', {
	userPhone: '08012345678',
	performedBy: '08099999999'
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

- https://seikho.github.io/evtstore/#/docs/commands?id=invoking

### Command design rules

- validate existence with `agg.version`
- block invalid lifecycle transitions like updates after delete
- normalize and validate input before emitting events
- emit no events on no-op updates
- return an array if one command should emit multiple events

Example multi-event return:

```ts
return [
	{ type: 'requisitionReviewed', reviewedBy: cmd.reviewedBy, reviewType: cmd.reviewType },
	{ type: 'requisitionStatusChanged', status: 'approved', performedBy: cmd.reviewedBy }
];
```

## Projections

Projections build read models from the event stream.

Official references:

- https://seikho.github.io/evtstore/#/docs/event-handlers

```ts
import { createHandler } from './domain';
import { getMongoClient } from './projection-shared';

export interface DepartmentProjection {
	departmentId: string;
	tenantId: string;
	name: string;
	description: string;
	managers: string[];
	dataContext: 'live' | 'test';
	deleted: boolean;
	deletedBy?: string;
	createdAt: string;
	updatedAt: string;
}

const departmentsModel = createHandler('departments-model', ['departments']);

departmentsModel.handle('departments', 'departmentCreated', async (id, event, meta) => {
	const client = await getMongoClient();
	const collection = client.db().collection<DepartmentProjection>('departments');

	await collection.replaceOne(
		{ departmentId: id },
		{
			departmentId: id,
			tenantId: event.tenantId,
			name: event.name,
			description: event.description || '',
			managers: [],
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
	const collection = client.db().collection<DepartmentProjection>('departments');
	const updateFields: Partial<DepartmentProjection> = {
		updatedAt: meta.timestamp.toISOString()
	};

	if (event.name !== undefined) updateFields.name = event.name;
	if (event.description !== undefined) updateFields.description = event.description;

	await collection.updateOne({ departmentId: id }, { $set: updateFields });
});

departmentsModel.handle('departments', 'departmentManagerAdded', async (id, event, meta) => {
	const client = await getMongoClient();
	const collection = client.db().collection<DepartmentProjection>('departments');

	await collection.updateOne(
		{ departmentId: id },
		{
			$addToSet: { managers: event.userPhone },
			$set: { updatedAt: meta.timestamp.toISOString() }
		}
	);
});

departmentsModel.handle('departments', 'departmentManagerRemoved', async (id, event, meta) => {
	const client = await getMongoClient();
	const collection = client.db().collection<DepartmentProjection>('departments');

	await collection.updateOne(
		{ departmentId: id },
		{
			$pull: { managers: event.userPhone },
			$set: { updatedAt: meta.timestamp.toISOString() }
		}
	);
});

departmentsModel.handle('departments', 'departmentDeleted', async (id, event, meta) => {
	const client = await getMongoClient();
	const collection = client.db().collection<DepartmentProjection>('departments');

	await collection.updateOne(
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

### Projection rules

- use `handle(stream, eventType, handler)`
- use `meta.timestamp` for projection timestamps
- use `replaceOne(..., { upsert: true })` for create events
- use `$set`, `$addToSet`, `$pull`, `$unset` for updates
- make handlers idempotent where possible
- start handlers during app bootstrap

### Handler options

`createHandler(...)` accepts options that are useful for projections and process managers:

```ts
const departmentsModel = createHandler('departments-model', ['departments'], {
	tailStream: false,
	alwaysTailStream: false,
	continueOnError: false
});
```

- `tailStream`: when first started, begin at the end of stream history
- `alwaysTailStream`: every start begins at the end of history
- `continueOnError`: continue processing after a handler throws, while delegating the error to the provider

Use `tailStream` for new subscribers that should ignore history. Use `continueOnError` only when you have acceptable error handling and observability.

Official references:

- https://seikho.github.io/evtstore/#/docs/event-handlers?id=handleroptions
- https://seikho.github.io/evtstore/#/docs/event-handlers?id=continueonerror
- https://seikho.github.io/evtstore/#/docs/event-handlers?id=tailstream

### Handler lifecycle

Useful handler methods:

- `start()` to begin the processing loop
- `stop()` to stop processing
- `runOnce()` to process all currently unhandled events once
- `reset()` to clear local bookmark state and force reloading bookmark position

Official references:

- https://seikho.github.io/evtstore/#/docs/event-handlers?id=eventhandler
- https://seikho.github.io/evtstore/#/docs/event-handlers?id=runonce
- https://seikho.github.io/evtstore/#/docs/event-handlers?id=reset

Example startup:

```ts
export function startProjection() {
	departmentsModel.start();
	userAccountsModel.start();
}
```

### Projection testing with `runOnce()`

`runOnce()` is especially useful in tests and one-shot processing:

```ts
await departmentCmd.create('department-123', {
	tenantId: 'tenant-1',
	name: 'Engineering',
	dataContext: 'live'
});

await departmentsModel.runOnce();

const department = await queryDepartments.getById('department-123');
expect(department?.name).toBe('Engineering');
```

If you need the handler to re-read its bookmark state, call `reset()` before the next run.

Official references:

- https://seikho.github.io/evtstore/#/docs/event-handlers?id=runonce

### Multiple-stream handlers

One handler can consume events from multiple streams as long as they come from the same provider.

```ts
const auditModel = createHandler('audit-model', ['users', 'profiles', 'posts']);

auditModel.handle('users', 'userCreated', async (id, event, meta) => {
	// ...
});

auditModel.handle('posts', 'postCreated', async (id, event, meta) => {
	// ...
});
```

Use this for composite read models or process managers that coordinate across aggregates.

Official references:

- https://seikho.github.io/evtstore/#/docs/multiple-streams

## Queries

Read from projection collections, not from event streams.

```ts
import type { WithId } from 'mongodb';
import { getMongoClient } from './projection-shared';
import type { DepartmentProjection } from './projection';

function cleanDoc<T>(doc: WithId<T> | null): T | null {
	if (!doc) return null;
	const { _id: _, ...rest } = doc;
	return rest as T;
}

function cleanDocs<T>(docs: WithId<T>[]): T[] {
	return docs.map((doc) => {
		const { _id: _, ...rest } = doc;
		return rest as T;
	});
}

export const queryDepartments = {
	getById: async (id: string): Promise<DepartmentProjection | null> => {
		const client = await getMongoClient();
		const doc = await client
			.db()
			.collection<DepartmentProjection>('departments')
			.findOne({ departmentId: id });
		return cleanDoc(doc as WithId<DepartmentProjection> | null);
	},

	getByTenant: async (tenantId: string): Promise<DepartmentProjection[]> => {
		const client = await getMongoClient();
		const docs = await client
			.db()
			.collection<DepartmentProjection>('departments')
			.find({ tenantId, deleted: { $ne: true } })
			.toArray();
		return cleanDocs(docs as WithId<DepartmentProjection>[]);
	}
};
```

### Query rules

- keep query code simple and projection-oriented
- strip `_id` before returning app-level types
- support filtering, sorting, and pagination at the query layer
- avoid coupling API responses directly to raw Mongo documents

## MongoDB Helpers

A shared singleton client is a good default.

```ts
import { MongoClient } from 'mongodb';

const singletonClientPromise: Record<string, Promise<MongoClient> | null> = {};

export async function getMongoClient(mongoUrl?: string): Promise<MongoClient> {
	const uri = mongoUrl ?? process.env.MONGO_URI;
	if (!uri) {
		throw new Error('MONGO_URI environment variable is not set.');
	}

	if (singletonClientPromise[uri]) {
		return singletonClientPromise[uri] as Promise<MongoClient>;
	}

	const client = new MongoClient(uri, {
		maxPoolSize: 50,
		minPoolSize: 5,
		maxIdleTimeMS: 30000,
		connectTimeoutMS: 10000,
		socketTimeoutMS: 60000,
		serverSelectionTimeoutMS: 5000,
		retryWrites: true,
		retryReads: true
	});

	singletonClientPromise[uri] = client.connect();
	return await singletonClientPromise[uri];
}
```

## Provider Options

MongoDB is a strong default and a good fit for many Node.js backends, but evtstore is not limited to MongoDB.

Official references:

- https://seikho.github.io/evtstore/#/docs/providers
- https://seikho.github.io/evtstore/#/docs/providers?id=mongodb
- https://seikho.github.io/evtstore/#/docs/providers?id=postgres-with-node-postgres
- https://seikho.github.io/evtstore/#/docs/providers?id=sql-with-knexjs
- https://seikho.github.io/evtstore/#/docs/providers?id=in-memory

Common provider options include:

- MongoDB
- Postgres with `postgres`
- Postgres with `pg`
- SQL via `knex`
- in-memory for tests and simple local scenarios
- Neo4j providers

The modeling approach stays mostly the same across providers:

- aggregates and commands stay the same
- domain wiring is nearly the same
- projection and query design stay the same
- only provider setup and persistence details change

## DataContext and Multi-Environment Data

If your app supports sandbox/test/live separation, include a `dataContext` field in create events and projection documents.

Example:

```ts
type DataContext = 'live' | 'test';
```

Guidelines:

- set `dataContext` only on create
- treat it as immutable afterward
- include it in projections for filtering
- if you support both legacy and new data, design filters carefully

## Eventual Consistency

Projection reads may lag behind writes.

If you need immediate feedback after a write, choose one of these patterns:

- return success without immediately querying the projection
- wait briefly before read-after-write in user-facing flows
- read aggregate state directly when appropriate for internal logic

Example:

```ts
await departmentCmd.create(id, payload);
await new Promise((resolve) => setTimeout(resolve, 300));
const department = await queryDepartments.getById(id);
```

Use waiting sparingly. Prefer designing flows that tolerate projection lag.

## Testing Guidance

Best candidates for unit tests:

- fold functions
- helper validators
- pure event-building helpers

Example fold test:

```ts
describe('foldDepartmentEvent', () => {
	it('applies departmentCreated', () => {
		const prev = {
			tenantId: '',
			name: '',
			managers: [],
			description: '',
			dataContext: 'test' as const,
			deleted: false
		};

		const evt: DepartmentEvt = {
			type: 'departmentCreated',
			tenantId: 'tenant-1',
			name: 'Engineering',
			dataContext: 'live'
		};

		const next = departmentAgg.fold(evt, prev);
		expect(next.name).toBe('Engineering');
		expect(next.dataContext).toBe('live');
	});
});
```

For command tests, prefer integration-style tests that call command methods the same way production code does:

```ts
await departmentCmd.create('department-123', {
	tenantId: 'tenant-1',
	name: 'Engineering',
	dataContext: 'live'
});
```

## Best Practices

- use past-tense event names
- make event payloads explicit and durable
- keep folds pure and deterministic
- validate in commands, not in projections
- keep projections read-optimized
- treat projections as disposable, rebuildable views
- skip emitting events for no-op updates
- keep `performedBy`, timestamps, and deletion metadata where useful for auditability

## Anti-Patterns

- passing `type` in command invocation payloads
- querying event streams directly for UI reads when projections exist
- mutating aggregate state inside folds
- placing business validation inside projection handlers
- encoding transient UI concerns into event names
- overloading one aggregate with unrelated responsibilities

## End-to-End Checklist

When adding a new evtstore-backed feature:

1. define `Evt`, `Agg`, and `Cmd` types
2. implement `createAggregate(...)`
3. implement `createCommands(...)`
4. register the aggregate in `createDomain(...)`
5. add projection document types
6. add projection handlers with `handle(...)`
7. start projection handlers during bootstrap
8. add query functions against projection collections
9. wire commands into routes, services, or RPC handlers
10. test folds, command behavior, and projection updates

## Snippet Reference

### Command call

```ts
await userAccountCmd.create(phone, {
	phone,
	dataContext: 'live',
	performedBy: phone
});
```

### No-op update

```ts
const changes = getChangedFields(cmd, agg, ['name', 'description']);
if (Object.keys(changes).length === 0) return [];
```

### Projection update

```ts
await collection.updateOne(
	{ departmentId: id },
	{ $set: { updatedAt: meta.timestamp.toISOString(), name: event.name } }
);
```

### Query cleanup

```ts
const { _id: _, ...rest } = doc;
return rest as DepartmentProjection;
```

If you are unsure how to implement a new feature, start with one aggregate, one command file, one projection collection, and one query module. Keep the first version small, then extend it.
