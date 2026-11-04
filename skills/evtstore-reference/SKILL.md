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
- make projection writes replay-safe
- batch projection writes and coalesce bookmark persistence
- read your own write without sleeping
- operate projections: health, rebuilds, graceful shutdown
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
			updatedAt: meta.timestamp.toISOString(),
			lastPosition: meta.position
		},
		{ upsert: true }
	);
});

departmentsModel.handle('departments', 'departmentUpdated', async (id, event, meta) => {
	const client = await getMongoClient();
	const collection = client.db().collection<DepartmentProjection>('departments');
	const updateFields: Partial<DepartmentProjection> = {
		updatedAt: meta.timestamp.toISOString(),
		lastPosition: meta.position
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
			$set: { lastPosition: meta.position },
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

> The examples below record `lastPosition` on every write. The filter guard that
> makes a replay a no-op is covered in [Projection Integrity](#projection-integrity);
> with a client wrapper you write it once, without one you add it to each filter.

### Projection rules

- use `handle(stream, eventType, handler)`
- use `meta.timestamp` for projection timestamps
- use `replaceOne(..., { upsert: true })` for create events
- use `$set`, `$addToSet`, `$pull`, `$unset` for updates
- make every mutable write replay-safe with the position guard (see [Projection Integrity](#projection-integrity)); idempotency is not optional once bookmarks can be deferred
- start handlers during app bootstrap, after indexes exist

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

## Projection Integrity

A handler will eventually process the same event twice: a crash, a redeploy, or a
deliberate rebuild replays the log from a persisted position. Every write must be
safe to apply twice.

### Stamp the applied position

Every mutable projection document records the position of the event it reflects.
`meta.position` is the BSON timestamp the store assigned to that event.

```ts
await collection.updateOne(
	{ departmentId: id },
	{
		$set: {
			name: event.name,
			updatedAt: meta.timestamp.toISOString(),
			lastPosition: meta.position
		}
	}
);
```

### Filter the write by it

The guard is a **filter fragment**, not a read-then-check:

```ts
const guarded = {
	...filter,
	$or: [{ lastPosition: { $lt: meta.position } }, { lastPosition: { $exists: false } }]
};
```

- a replayed event matches no document and changes nothing;
- an older event cannot move state backwards;
- a document written before the guard existed matches once, then is stamped.

A read-then-check is not equivalent: it adds a race window to handlers that
already read their own documents.

### Creates and upserts

Keep the upsert and the guard together. On replay the guarded filter matches
nothing, so the upsert attempts an insert and meets the unique index — treat a
duplicate key as "already applied":

```ts
try {
	await collection.replaceOne(
		guarded,
		{ ...doc, lastPosition: meta.position },
		{ upsert: true }
	);
} catch (err) {
	if (!isDuplicateKey(err)) throw err;
}
```

Without a unique index on the document key, that insert succeeds and you get a
duplicate row. **Every projection collection needs a unique index on the key its
upserts filter by, and handlers must not start before those indexes exist.**

### Counters and arrays

`$inc`, `$push` and `$pull` are the operations that break a replay. They carry the
same guard on the parent document, which works because each is driven by an event
on that document. Prefer `$addToSet` when the element has a stable identity.

One rule falls out of this: **a handler writes a given document at most once per
event**, because the guard admits one write per position. If two updates are
needed, merge them into one operator update. Report the case if you cannot — a
silently skipped second write is worse than a loud one.

### Position, not aggregate version

A guard on `{aggregateId, version}` is enough only when a document is written
exclusively by one aggregate's events. Documents written by several aggregates — a
reviewer cache rebuilt from `requisitions`, `categories` and `departments` events,
an activity ledger fed by `pictureCaptures` and `agentPayouts` — break it: versions
are only ordered inside one aggregate, so a legitimate write whose version happens
to be lower is silently dropped.

Event positions are ordered across the whole store, so one marker is correct for
every write pattern.

### Apply it centrally

Per-write guards leave the invariant one forgotten call away from broken, and every
new handler must remember. Prefer a single wrapper that rewrites the guard in while
the event context is in scope; the appendices show both wirings.

```
handler write → guard wrapper (rewrites filter + $set.lastPosition) → driver
```

The wrapper must be inert outside a handler (routes and migrations write the same
collections) and must detect a handler writing one document twice for an event,
since the second write is the one case the guard cannot admit.

## Projection Throughput

Two round trips dominate a projection loop: the write itself, and the bookmark.
Both can be batched without weakening the guarantees above.

### Coalesce bookmark writes

`evtstore` persists the bookmark after **every** event. Decorate the bookmark
instead of changing handlers:

```ts
export function batchingBookmark(
	provider,
	name,
	{ maxPending = 200, maxDelayMs = 1000, beforePersist }: BatchingBookmarkOptions = {}
) {
	const inner = createBookmark(provider, name);
	return new BatchingBookmark(inner, maxPending, maxDelayMs, beforePersist);
}

const departmentsModel = createHandler(
	batchingBookmark(provider, 'departments-model', {
		beforePersist: () => flushProjectionWrites() // never persist ahead of the buffer
	}),
	['departments']
);
```

`BatchingBookmark` is a helper you write, not an `evtstore` export — the full class is
in [Snippet Reference](#batchingbookmark).

Rules that keep this safe:

- flush **before** `getPosition` — a handler reads its position at start and on `reset()`;
- flush **before any bookmark write**, and never persist a position ahead of
  buffered projection writes;
- flush on shutdown, and retain the position when a write fails so it is retried;
- the crash window becomes one window (default 200 events or one second), which is
  acceptable only because of the position guard.

### Buffer projection writes

Queue `updateOne` / `replaceOne` / `insertOne` per collection and flush them as one
ordered `bulkWrite`:

- **Flush before a read of that collection** — including cursors. `find()` returns
  before any I/O, so the flush belongs on the first terminal call (`toArray`,
  `next`, `hasNext`, `forEach`, async iteration), not when the cursor is built.
- **Flush at the end of a handler run** (`postRun`), so a caller that awaited the
  run can read its own write.
- **Never buffer event appends or bookmark writes.**
- Buffer only collections projection handlers write. A collection that routes or
  migrations also write keeps its immediate semantics — including surfacing write
  errors synchronously.
- On a failed batch, re-apply in order, tolerate duplicate keys, re-queue the first
  real failure and its tail, and mark **that collection** blocked. An enqueue
  against a blocked collection flushes and then throws rather than dropping writes.
- Cap the queue, and keep a kill switch for both features.

### Order of the two wrappers

The guard must run **while the event context is in scope**, so it wraps the buffer —
the buffer defers the driver call to flush time, when the context is gone.

```
handler write → guard wrapper (rewrites filter/update) → buffer (queues) → driver
```

### What it buys

Measured on one 5 000-event burst through a single handler over a loopback
connection:

| | Before | After |
| --- | --- | --- |
| Wall time | 1 391 ms | 278 ms |
| Projection round trips | 5 000 | 5 (`bulkWrite`, one per 1 000-event page) |
| Bookmark writes | 5 000 | 25 |

On a link where a round trip costs milliseconds the difference is larger still.

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

## Reading Your Own Writes

Projection reads are eventually consistent, and the handler loop does not wake on an
append: `evtstore` polls on a one-second timer. A fixed delay therefore cannot answer
"has my write reached the projection?" — a 500 ms wait covers roughly half the poll
window, and a coalesced run can return before it fetched the page containing your
event.

### Wait on the position

A handler's persisted position is the only durable statement of how far it has
applied. Resolve the target once, then wait for every handler in scope to reach it:

```ts
await departmentCmd.create(id, payload);
await waitForProjection('departments', { aggregateId: id });
// every handler for the stream has applied the event; reads are current
```

- name a **stream** to wait for every handler on it — a user-account write has to
  cover the account, the credential index and the activity ledger together; name a
  **bookmark** to wait for one;
- the target is an `aggregateId`, an explicit `position`, or the stream `head`;
- drive the catch-up yourself through one coalesced run per bookmark; do not lean on
  the tail loop for latency;
- bound the wait, back off, and warn once when it is slow.

### Failure is not success

- `ProjectionLagError` — the handler did not get there in time. Map it to a
  retryable response; do not render stale data.
- `ProjectionFailedError` — the handler **recorded a failure at or after your
  target**. A `continueOnError` handler advances its bookmark past an event whose
  callback threw, so a position check alone reports success on a write that never
  landed. Record handler failures (bookmark, position, event type, message) and
  refuse to resolve across one.

Authentication and provisioning are the one place a short, best-effort wait is
right: sign-in must not fail because a read model is slow.

### Make the catch-up helper deterministic

If the code already has a `debouncedRunOnce(label, run)` helper, note that it
resolves with an *in-flight* run — which may have fetched its page before your
write. Have it finish by waiting for the stream head:

```ts
export function debouncedRunOnce(label: string, run: () => Promise<unknown>) {
	return coalescedRun(label, run).then(() =>
		handlerExists(label) ? waitForProjection(label, { head: true }) : undefined
	);
}
```

### Anti-pattern

```ts
// Never: neither fast nor correct.
await departmentCmd.create(id, payload);
await new Promise((resolve) => setTimeout(resolve, 300));
const department = await queryDepartments.getById(id);
```

## Operating Projections

### Publish what you run

At startup, write the handler registry — bookmark name, streams, projection
collections — to a collection. A standalone health check or rebuild script can then
work without importing application modules, and without a second list of names that
drifts from the code.

### Health

Report per bookmark: persisted position, stream head, gap, and state.

| State | Meaning | Fails the check? |
| --- | --- | --- |
| `ok` | caught up | no |
| `BEHIND` | gap above the threshold | yes |
| `IDLE` | registered, but its streams hold no events | no |
| `NEVER-PERSISTED` | events are waiting and no position exists | yes |
| `ORPHAN` | a bookmark whose handler no longer exists | no |

Account for the coalescing window when choosing the threshold: a persisted bookmark
may trail by one window (200 events or one second) while the projection is current.
A removed handler must not fail the check forever, and a handler that has never had
an event to process is idle, not behind.

Record handler failures durably (one document per failure) and fail the check when
one arrived in the window.

### Rebuild

**Rebuilding means dropping the projection documents and the bookmark together.**
Deleting only the bookmark replays the log but every guarded write matches no
document, so nothing is rebuilt — and documents that predate the guard accept their
first write on replay, double-applying increments.

```bash
npm run es:rebuild -- --list                       # bookmarks, streams, bookmark presence
npm run es:rebuild -- --all                        # preview; refuses when rows predate the guard
npm run es:rebuild -- --all --allow-unstamped --yes
npm run es:rebuild -- --bookmark=tenants-model --collection=tenants --yes
```

A rebuild script should preview by default, refuse when a targeted collection holds
documents without `lastPosition` (dropping them discards the only projection of
events written before the guard), verify the collections are empty afterwards, and
tell the operator to **restart**: handlers keep their position in memory, so a
deleted bookmark is only observed by a new process.

## Shutdown

Flush deferred bookmarks when the process stops — and own the exit once you do.

```ts
const flush = () => flushAllBookmarks();

process.prependOnceListener('SIGTERM', () => void flush().then(() => exit()));
process.prependOnceListener('SIGINT', () => void flush().then(() => exit()));
```

- **A signal listener suppresses Node's default termination.** The listener that
  suppresses it must finish the job, or the process hangs — and with a Mongo
  connection pool the event loop never drains.
- Under an adapter that closes the server itself (SvelteKit's `adapter-node`), do
  not exit on the signal: flush, then exit on the adapter's shutdown event, after
  the server has closed.
- **Prepend** the handler so the flush starts before the framework's exit path.
- Register **once per process**, not once per module evaluation. A dev server
  re-evaluates modules on HMR, and a module-local flag stacks a listener per reload;
  guard the registration on a `globalThis` symbol.

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

### Test the replay, not just the happy path

- **Replay convergence:** project a batch, snapshot the documents, flush bookmarks,
  delete the bookmark, reset the handler, replay, and deep-compare. Any
  non-idempotent write shows up here.
- **Counters:** replay an `$inc` event and assert the counter moved once.
- **Guards through the real driver:** use an in-memory MongoDB for handler tests; a
  mocked collection will not exercise a unique index or a BSON position comparison.
- **Kill switches:** assert the disabled path writes per event.
- **Staged rollout rehearsal:** a test gated behind an environment flag that
  exercises every projection area, a replay and a short soak at each deployment
  stage — guards only, then bookmark coalescing, then the write buffer.

## Best Practices

- use past-tense event names
- make event payloads explicit and durable
- keep folds pure and deterministic
- validate in commands, not in projections
- keep projections read-optimized
- treat projections as disposable, rebuildable views — and rebuild by dropping the
  documents, not just the bookmark
- guard every mutable projection write by event position
- keep a unique index on every key a handler upserts by
- wait on positions after a write, never on a delay
- flush buffered writes before persisting a bookmark, and on shutdown
- treat the coalescing window as the replay window when sizing alerts
- skip emitting events for no-op updates
- keep `performedBy`, timestamps, and deletion metadata where useful for auditability

## Anti-Patterns

- passing `type` in command invocation payloads
- querying event streams directly for UI reads when projections exist
- mutating aggregate state inside folds
- placing business validation inside projection handlers
- encoding transient UI concerns into event names
- overloading one aggregate with unrelated responsibilities
- `setTimeout`/`sleep` as a read-after-write strategy
- a single `lastVersion` on a document written by several aggregates
- persisting a bookmark ahead of buffered projection writes
- read-then-check guards (`findOne` and then decide)
- buffering collections that routes or migrations also write
- adding a signal listener without owning the exit that it now suppresses

## End-to-End Checklist

When adding a new evtstore-backed feature:

1. define `Evt`, `Agg`, and `Cmd` types
2. implement `createAggregate(...)`
3. implement `createCommands(...)`
4. register the aggregate in `createDomain(...)`
5. add projection document types, with `lastPosition` on every mutable document
6. add projection handlers with `handle(...)`
7. add a unique index for every key a handler upserts by, before handlers start
8. guard every mutable write by event position — through the wrapper if you have one
9. start projection handlers during bootstrap, after the indexes exist
10. wait on the position after a write; never on a delay
11. flush buffered writes at the end of every run and on shutdown
12. publish the handler registry so health and rebuild tools can read it
13. add query functions against projection collections
14. wire commands into routes, services, or RPC handlers
15. test folds, command behavior, replay convergence, and projection updates

## Snippet Reference

The snippets are shapes, not a package. Symbols that are not `evtstore` exports are
helpers you write: the three with the most subtle behaviour are shown in full below,
the rest are listed with their contract and the section that specifies them. Every
lookup the wait loop calls is defined under [Supporting lookups](#supporting-lookups).

### Helpers you write

| Helper | Contract | Specified in |
| --- | --- | --- |
| `BatchingBookmark` | coalesces `setPosition`; flushes before a read and on shutdown | below |
| `waitForProjection` | resolves once every handler in scope applied the target position | below |
| `catchUp` | `waitForProjection(scope, { head: true })` | below |
| `installWriteBuffer` | per-collection queues, flushed as ordered `bulkWrite` batches | Projection Throughput |
| `installPositionGuards` | rewrites handler writes with the position guard | Projection Integrity |
| `flushProjectionWrites` | flushes the buffer at the end of every handler run | Projection Throughput |
| `flushAllBookmarks` | flushes every registered bookmark | Shutdown |
| `registerShutdownFlush` | one signal listener per process, which owns the exit | Shutdown |
| `registerProjectionHandler` | bookmark to streams to collections registry | Operating Projections |
| `coalescedRun` | one in-flight run per bookmark | Reading Your Own Writes |
| `isDuplicateKey` | duplicate-key detection, so a replayed upsert is a no-op | Projection Integrity |

### BatchingBookmark

```ts
import type { ProviderBookmark } from 'evtstore';

export type BatchingBookmarkOptions = {
	maxPending?: number;
	maxDelayMs?: number;
	/** Runs before persisting: flush the projection write buffer here. */
	beforePersist?: () => Promise<void>;
};

export class BatchingBookmark implements ProviderBookmark {
	readonly name: string;
	private latest: unknown;
	private pending = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private chain: Promise<void> = Promise.resolve();

	constructor(
		private readonly inner: ProviderBookmark,
		private readonly maxPending = 200,
		private readonly maxDelayMs = 1000,
		private readonly beforePersist?: () => Promise<void>
	) {
		this.name = inner.name;
	}

	async getPosition(): Promise<unknown> {
		// A handler reads its position at start and on reset(); the read must see
		// what was persisted, not what is still deferred.
		await this.flush();
		return this.inner.getPosition();
	}

	async setPosition(position: unknown): Promise<void> {
		// Newest wins: only the latest position is ever written.
		this.latest = position;
		this.pending += 1;
		if (this.pending >= this.maxPending) return this.flush();
		this.schedule();
	}

	async flush(): Promise<void> {
		this.clearTimer();
		if (this.pending === 0) return;

		const position = this.latest;
		this.latest = undefined;
		this.pending = 0;

		const write = this.chain
			.catch(() => undefined)
			.then(() => this.beforePersist?.())
			.then(() => this.inner.setPosition(position));
		this.chain = write.catch(() => undefined);

		try {
			await write;
		} catch (err) {
			// Keep it for the next attempt; a newer position wins if one arrived.
			if (this.latest === undefined) {
				this.latest = position;
				this.pending = Math.max(1, this.pending);
			}
			this.schedule();
			throw err;
		}
	}

	private schedule(): void {
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.flush().catch((err) => console.error('[evtstore] bookmark flush failed', err));
		}, this.maxDelayMs);
		this.timer.unref?.();
	}

	private clearTimer(): void {
		if (!this.timer) return;
		clearTimeout(this.timer);
		this.timer = null;
	}
}
```

Register each instance so shutdown can flush it, or `flushAllBookmarks()` will miss it.

### Waiting for a projection

```ts
export class ProjectionLagError extends Error {
	constructor(
		readonly bookmarks: string[],
		readonly target: string,
		readonly elapsedMs: number
	) {
		super(`projection did not reach ${target} within ${elapsedMs} ms`);
	}
}

export class ProjectionFailedError extends Error {
	constructor(
		readonly bookmark: string,
		readonly target: string
	) {
		super(`projection ${bookmark} failed at or after ${target}`);
	}
}

export async function waitForProjection(
	scope: string | string[],
	target: { position: unknown } | { aggregateId: string } | { head: true },
	{ timeoutMs = 5_000, slowWarnMs = 1_000 } = {}
): Promise<void> {
	const bookmarks = resolveBookmarks(scope); // a stream expands to all its handlers
	const wanted = await resolveTarget(bookmarks, target); // resolved once, never moving
	if (wanted === null) return; // empty stream: nothing to wait for
	const started = Date.now();
	let interval = 20;

	for (;;) {
		// Read first: a projection already at the target must not pay for a run.
		const positions = await Promise.all(bookmarks.map(persistedPosition));

		// A dead-lettered event still advances the bookmark, so check it before
		// declaring success.
		const failure = lastHandlerFailureAtOrAfter(bookmarks, wanted);
		if (failure) throw new ProjectionFailedError(failure.bookmark, wanted);

		if (positions.every((position) => atOrAfter(position, wanted))) {
			if (Date.now() - started >= slowWarnMs) {
				console.warn(`[evtstore] slow projection wait: ${bookmarks.join(', ')}`);
			}
			return;
		}

		if (Date.now() - started >= timeoutMs) {
			throw new ProjectionLagError(bookmarks, wanted, Date.now() - started);
		}

		for (const name of bookmarks) await coalescedRun(name); // drive the catch-up
		await delay(interval);
		interval = Math.min(250, Math.round(interval * 1.5));
	}
}

export const catchUp = (scope: string | string[], options: { timeoutMs?: number } = {}) =>
	waitForProjection(scope, { head: true }, options);
```

### Supporting lookups

The wait loop leans on a handful of small readers plus a promise-based delay. They
are shown here so the snippet above stands on its own; in a real codebase they live
next to the handler registry.

```ts
import { setTimeout as delay } from 'node:timers/promises';

type RegisteredHandler = {
	name: string;
	streams: string[];
	runOnce: () => Promise<number>;
	getPosition: () => Promise<unknown>; // the persisted bookmark position
};

type WaitTarget = { position: unknown } | { aggregateId: string } | { head: true };

declare const handlers: Map<string, RegisteredHandler>;
declare const handlerFailures: Map<string, { position: unknown; message: string }>;
declare const provider: {
	getLastEventFor: (
		streams: string[],
		aggregateId?: string
	) => Promise<{ position: unknown } | undefined>;
};

/** A bookmark name, or a stream expanded to every handler that consumes it. */
const resolveBookmarks = (scope: string | string[]): string[] =>
	(Array.isArray(scope) ? scope : [scope]).flatMap((name) => {
		if (handlers.has(name)) return [name];

		const consumers = [...handlers.values()].filter((handler) => handler.streams.includes(name));
		if (consumers.length === 0) throw new Error(`unknown scope "${name}"`);
		return consumers.map((handler) => handler.name);
	});

/** The target position, resolved once so it cannot chase a moving head. */
const resolveTarget = async (bookmarks: string[], target: WaitTarget): Promise<string | null> => {
	const streams = [...new Set(bookmarks.flatMap((name) => handlers.get(name)?.streams ?? []))];

	if ('position' in target) return String(target.position);

	if ('aggregateId' in target) {
		const event = await provider.getLastEventFor(streams, target.aggregateId);
		return event ? String(event.position) : null; // no such aggregate yet
	}

	const head = await provider.getLastEventFor(streams);
	return head ? String(head.position) : null; // empty stream: nothing to reach
};

const persistedPosition = (name: string): Promise<unknown> =>
	handlers.get(name)?.getPosition() ?? Promise.resolve(null);

const atOrAfter = (position: unknown, wanted: string): boolean =>
	position != null && BigInt(String(position)) >= BigInt(wanted);

/** A failure recorded at or after the target means the event never landed. */
const lastHandlerFailureAtOrAfter = (bookmarks: string[], wanted: string) =>
	bookmarks
		.flatMap((name) => {
			const failure = handlerFailures.get(name);
			return failure && atOrAfter(failure.position, wanted) ? [{ bookmark: name, ...failure }] : [];
		})
		.at(0);

const handlerExists = (name: string): boolean => handlers.has(name);
```

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

### Guarded update

```ts
await collection.updateOne(
	{
		departmentId: id,
		$or: [{ lastPosition: { $lt: meta.position } }, { lastPosition: { $exists: false } }]
	},
	{ $set: { name: event.name, lastPosition: meta.position } }
);
```

### Wait for the projection

```ts
await waitForProjection('departments', { aggregateId: id });
// or, for every handler on the stream, up to its head:
await catchUp('departments');
```

### Operate it

```bash
npm run es:health                                     # gap, idle, orphan, recent handler errors
npm run es:rebuild -- --all --allow-unstamped --yes   # drop documents and bookmarks, then restart
```

If you are unsure how to implement a new feature, start with one aggregate, one command file, one projection collection, and one query module. Keep the first version small, then extend it.

## Appendix A: Generic Node.js wiring

The smallest shape that delivers the guarantees above. Each piece is described in
the sections it implements; this is how they compose.

```ts
// projection/runtime.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { MongoClient } from 'mongodb';
import type { EventMeta } from 'evtstore';

// 1. Event context: the handler wrapper binds it, the write wrappers read it.
const eventStorage = new AsyncLocalStorage<EventMeta>();
export const currentEvent = () => eventStorage.getStore();

// 2. One client for the read side. Install the buffer FIRST, then the guard, so
//    the guard runs while the event context is still in scope.
let clientPromise: Promise<MongoClient> | undefined;
export function getProjectionClient(): Promise<MongoClient> {
  clientPromise ??= (async () => {
    const client = await MongoClient.connect(process.env.MONGO_URI!);
    installWriteBuffer(client, projectionCollections);   // queues handler writes
    installPositionGuards(client, projectionCollections); // rewrites filter + lastPosition
    return client;
  })();
  return clientPromise;
}

// 3. Guard wrapper: intercepts updateOne/replaceOne/insertOne/bulkWrite on
//    projection collections. `currentEvent()` undefined => pass straight through.
//    The guard must be the OUTER wrapper: the buffer defers the driver call to
//    flush time, when the event context is gone.

// 4. Handler wrapper: binds the event, flushes the buffer at the end of every run.
export function createProjectionHandler(bookmark, streams, options = {}) {
  const handler = createHandler(bookmark, streams, {
    ...options,
    hooks: {
      ...options.hooks,
      postRun: async (...args) => {
        await options.hooks?.postRun?.(...args);
        await flushProjectionWrites();
      }
    }
  });

  const register = handler.handle.bind(handler);
  handler.handle = (stream, type, callback) =>
    register(stream, type, (id, event, meta) =>
      eventStorage.run(meta, () => callback(id, event, meta))
    );

  registerProjectionHandler({ name: handler.name, streams, handler });
  return handler;
}
```

Bootstrap, once per process:

```ts
async function bootstrap() {
  const db = (await getProjectionClient()).db();
  await initializeIndexes(db);          // unique keys before any handler starts
  await persistHandlerRegistry(db);     // bookmark -> streams -> collections
  startHandlers();                      // handler.start() for every model
  registerShutdownFlush();              // flush on SIGTERM/SIGINT, then exit
}
```

Bookmarks are decorated at creation, not at bootstrap:

```ts
const departmentsModel = createProjectionHandler(
  batchingBookmark(provider, 'departments-model'),
  ['departments']
);
```

Environment switches for both optimisations, read once at install time:

```bash
DISABLE_EVTSTORE_WRITE_BUFFER=true
DISABLE_EVTSTORE_BOOKMARK_BATCHING=true
EVTSTORE_BOOKMARK_MAX_PENDING=200
EVTSTORE_BOOKMARK_MAX_DELAY_MS=1000
EVTSTORE_WRITE_BUFFER_LIMIT=500
```

## Appendix B: SvelteKit wiring

SvelteKit adds three wrinkles: the server has no single bootstrap hook, the dev
server re-evaluates modules on HMR, and `adapter-node` owns the shutdown.

```ts
// src/lib/server/projection-shared.ts
export async function getMongoClient(uri = process.env.MONGO_URI) {
  const client = await connect(uri);
  // Buffer first, guard second — the guard must wrap the queue.
  installWriteBuffer(client, projectionCollections);
  installPositionGuards(client, projectionCollections);
  return client;
}
```

Bootstrap on the first request, then never again:

```ts
// src/hooks.server.ts
let started = false;

export const handle: Handle = async ({ event, resolve }) => {
  if (!started) {
    started = true;
    void bootstrapProjection();   // indexes -> registry -> handler.start()
    registerShutdownFlush();      // guarded on a globalThis symbol
  }
  return resolve(event);
};
```

- **Start handlers after the indexes exist.** A replayed upsert relies on its unique
  key to turn the duplicate insert into a no-op; starting first reopens the race.
- **HMR**: the dev server re-evaluates `hooks.server.ts`, resetting module-level
  flags. Keep the once-only guards (bootstrap, shutdown registration) on
  `globalThis`, or a long session stacks listeners.
- **Shutdown**: `adapter-node` closes the HTTP server and emits
  `sveltekit:shutdown`; it never calls `process.exit`, and open Mongo sockets keep
  the loop alive. Flush on the signal, exit on that event. Under `vite dev` there is
  no adapter, so the listener that suppressed the default exit must exit itself.

Reading your own write in a form action:

```ts
import { waitForProjection, ProjectionLagError } from '$lib/server/projection/consistency';

try {
  await departmentCmd.update(id, { name });
  await waitForProjection('departments', { aggregateId: id });
} catch (err) {
  if (err instanceof ProjectionLagError) return fail(503, { error: 'Try again in a moment' });
  throw err;
}
```

Keep two scripts beside the app, both without application imports:

```json
{
  "scripts": {
    "es:health": "node scripts/es-health.mjs",
    "es:rebuild": "node scripts/es-rebuild.mjs",
    "es:rollout-check": "ES_ROLLOUT_CHECK=1 vitest run src/.../rollout-check.integration.test.ts"
  }
}
```

The rollout check is a gated integration test: it runs the areas, a replay and a
short soak once per deployment stage (`DISABLE_*` flags), so the staged rollout is
rehearsed against a real database before it is done in production.
