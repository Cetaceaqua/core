const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
type DatabaseType = InstanceType<typeof DatabaseSync>;

import { randomBytes } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { get as lget, set as lset, unset as lunset, isPlainObject, isEqual } from 'lodash';

export interface StoreOptions {
  filename: string;
  timestampData?: boolean;
}

interface RawRow {
  _id: string;
  __s: string | null;
  __refid: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  data: string;
}

type Doc = Record<string, any>;

function matchValue(actual: any, expected: any): boolean {
  if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (actual.length !== expected.length) return false;
    return actual.every((v, i) => isEqual(v, expected[i]));
  }
  if (expected === null || typeof expected !== 'object') {
    if (Array.isArray(actual)) return actual.includes(expected);
    return isEqual(actual, expected);
  }
  return isEqual(actual, expected);
}

function matchOperators(actual: any, ops: Record<string, any>): boolean {
  for (const op of Object.keys(ops)) {
    const opVal = ops[op];
    switch (op) {
      case '$lt':
        if (!(actual < opVal)) return false;
        break;
      case '$lte':
        if (!(actual <= opVal)) return false;
        break;
      case '$gt':
        if (!(actual > opVal)) return false;
        break;
      case '$gte':
        if (!(actual >= opVal)) return false;
        break;
      case '$eq':
        if (!matchValue(actual, opVal)) return false;
        break;
      case '$ne':
        if (matchValue(actual, opVal)) return false;
        break;
      case '$in':
        if (!Array.isArray(opVal) || !opVal.some(v => matchValue(actual, v))) return false;
        break;
      case '$nin':
        if (Array.isArray(opVal) && opVal.some(v => matchValue(actual, v))) return false;
        break;
      case '$exists':
        if (Boolean(opVal) !== (actual !== undefined)) return false;
        break;
      case '$regex': {
        const re = opVal instanceof RegExp ? opVal : new RegExp(opVal);
        if (typeof actual !== 'string' || !re.test(actual)) return false;
        break;
      }
      case '$size':
        if (!Array.isArray(actual) || actual.length !== opVal) return false;
        break;
      case '$elemMatch': {
        if (!Array.isArray(actual)) return false;
        if (!actual.some(item => matchClause(item, opVal))) return false;
        break;
      }
      default:
        if (!matchValue(actual?.[op], opVal)) return false;
    }
  }
  return true;
}

function matchField(actual: any, clause: any): boolean {
  if (clause instanceof RegExp) return typeof actual === 'string' && clause.test(actual);
  if (isPlainObject(clause)) {
    const keys = Object.keys(clause);
    const allOps = keys.length > 0 && keys.every(k => k.startsWith('$'));
    if (allOps) return matchOperators(actual, clause);
  }
  return matchValue(actual, clause);
}

function matchClause(doc: any, query: any): boolean {
  if (!isPlainObject(query)) return false;
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (key === '$or') {
      if (!Array.isArray(value) || !value.some(sub => matchClause(doc, sub))) return false;
    } else if (key === '$and') {
      if (!Array.isArray(value) || !value.every(sub => matchClause(doc, sub))) return false;
    } else if (key === '$not') {
      if (matchClause(doc, value)) return false;
    } else if (key === '$where') {
      try {
        if (!value.call(doc)) return false;
      } catch {
        return false;
      }
    } else {
      const actual = key.includes('.') ? lget(doc, key) : doc?.[key];
      if (!matchField(actual, value)) return false;
    }
  }
  return true;
}

function setPath(doc: any, path: string, val: any) {
  if (path.includes('.')) lset(doc, path, val);
  else doc[path] = val;
}

function getPath(doc: any, path: string): any {
  if (path.includes('.')) return lget(doc, path);
  return doc?.[path];
}

function unsetPath(doc: any, path: string) {
  if (path.includes('.')) lunset(doc, path);
  else delete doc[path];
}

function applyUpdate(doc: Doc, update: any): Doc {
  const clone = JSON.parse(JSON.stringify(doc));
  const keys = Object.keys(update);
  const isOpUpdate = keys.length > 0 && keys.every(k => k.startsWith('$'));

  if (!isOpUpdate) {
    const preserved = { _id: clone._id };
    return { ...preserved, ...JSON.parse(JSON.stringify(update)) };
  }

  for (const op of keys) {
    const ops = update[op];
    if (!isPlainObject(ops)) continue;
    for (const path of Object.keys(ops)) {
      const opVal = ops[path];
      switch (op) {
        case '$set':
          setPath(clone, path, opVal);
          break;
        case '$unset':
          unsetPath(clone, path);
          break;
        case '$inc': {
          const cur = getPath(clone, path);
          setPath(clone, path, (typeof cur === 'number' ? cur : 0) + Number(opVal));
          break;
        }
        case '$max': {
          const cur = getPath(clone, path);
          if (cur === undefined || opVal > cur) setPath(clone, path, opVal);
          break;
        }
        case '$min': {
          const cur = getPath(clone, path);
          if (cur === undefined || opVal < cur) setPath(clone, path, opVal);
          break;
        }
        case '$push': {
          const cur = getPath(clone, path);
          const arr = Array.isArray(cur) ? cur : [];
          if (isPlainObject(opVal) && Array.isArray(opVal.$each)) {
            arr.push(...opVal.$each);
          } else {
            arr.push(opVal);
          }
          setPath(clone, path, arr);
          break;
        }
        case '$addToSet': {
          const cur = getPath(clone, path);
          const arr = Array.isArray(cur) ? cur : [];
          const add = (v: any) => {
            if (!arr.some(x => isEqual(x, v))) arr.push(v);
          };
          if (isPlainObject(opVal) && Array.isArray(opVal.$each)) opVal.$each.forEach(add);
          else add(opVal);
          setPath(clone, path, arr);
          break;
        }
        case '$pop': {
          const cur = getPath(clone, path);
          if (Array.isArray(cur) && cur.length > 0) {
            if (opVal === -1) cur.shift();
            else cur.pop();
            setPath(clone, path, cur);
          }
          break;
        }
        case '$pull': {
          const cur = getPath(clone, path);
          if (Array.isArray(cur)) {
            let next: any[];
            if (isPlainObject(opVal) && Array.isArray((opVal as any).$in)) {
              const banned = (opVal as any).$in;
              next = cur.filter(x => !banned.some((v: any) => isEqual(v, x)));
            } else if (isPlainObject(opVal)) {
              next = cur.filter(x => !matchClause(x, opVal));
            } else {
              next = cur.filter(x => !isEqual(x, opVal));
            }
            setPath(clone, path, next);
          }
          break;
        }
      }
    }
  }
  return clone;
}

class Cursor<T extends Doc> implements PromiseLike<T[]> {
  private _sort: Record<string, 1 | -1> | null = null;
  private _limit: number | null = null;
  private _skip: number | null = null;
  constructor(private fetch: () => T[]) {}

  sort(spec: Record<string, 1 | -1>): this {
    this._sort = spec;
    return this;
  }
  limit(n: number): this {
    this._limit = n;
    return this;
  }
  skip(n: number): this {
    this._skip = n;
    return this;
  }

  async exec(): Promise<T[]> {
    let rows = this.fetch();
    if (this._sort) {
      const keys = Object.keys(this._sort);
      rows = rows.slice().sort((a, b) => {
        for (const k of keys) {
          const dir = this._sort![k];
          const av = lget(a, k);
          const bv = lget(b, k);
          if (av < bv) return -1 * dir;
          if (av > bv) return 1 * dir;
        }
        return 0;
      });
    }
    if (this._skip !== null) rows = rows.slice(this._skip);
    if (this._limit !== null) rows = rows.slice(0, this._limit);
    return rows;
  }

  execAsync(): Promise<T[]> {
    return this.exec();
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

export class SqliteStore {
  private db: DatabaseType;
  private filename: string;
  private timestampData: boolean;

  constructor(opts: StoreOptions) {
    this.filename = opts.filename;
    this.timestampData = opts.timestampData !== false;
    const dir = path.dirname(this.filename);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(this.filename);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        _id        TEXT PRIMARY KEY,
        __s        TEXT,
        __refid    TEXT,
        createdAt  INTEGER,
        updatedAt  INTEGER,
        data       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_s        ON documents(__s);
      CREATE INDEX IF NOT EXISTS idx_documents_refid    ON documents(__refid);
      CREATE INDEX IF NOT EXISTS idx_documents_s_refid  ON documents(__s, __refid);
    `);

    const addColumnIfMissing = (sql: string) => {
      try {
        this.db.exec(sql);
      } catch (err: any) {
        if (!/duplicate column/i.test(err?.message || '')) throw err;
      }
    };
    addColumnIfMissing(
      `ALTER TABLE documents ADD COLUMN _collection TEXT GENERATED ALWAYS AS (json_extract(data, '$.collection')) VIRTUAL`
    );
    addColumnIfMissing(
      `ALTER TABLE documents ADD COLUMN _mid INTEGER GENERATED ALWAYS AS (CAST(json_extract(data, '$.mid') AS INTEGER)) VIRTUAL`
    );
    addColumnIfMissing(
      `ALTER TABLE documents ADD COLUMN _version INTEGER GENERATED ALWAYS AS (CAST(json_extract(data, '$.version') AS INTEGER)) VIRTUAL`
    );

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_documents_collection       ON documents(_collection);
      CREATE INDEX IF NOT EXISTS idx_documents_coll_version     ON documents(_collection, _version);
      CREATE INDEX IF NOT EXISTS idx_documents_s_collection     ON documents(__s, _collection);
      CREATE INDEX IF NOT EXISTS idx_documents_refid_collection ON documents(__refid, _collection);
      CREATE INDEX IF NOT EXISTS idx_documents_refid_coll_mid   ON documents(__refid, _collection, _mid);
    `);
  }

  async loadDatabaseAsync(): Promise<void> {}
  async ensureIndexAsync(_opts: { fieldName: string }): Promise<void> {}

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw err;
    }
  }

  private prefilter(query: any): { sql: string; params: any[] } {
    const wheres: string[] = [];
    const params: any[] = [];
    if (query && isPlainObject(query)) {
      const s = query.__s;
      if (typeof s === 'string') {
        wheres.push('__s = ?');
        params.push(s);
      }
      const r = query.__refid;
      if (typeof r === 'string') {
        wheres.push('__refid = ?');
        params.push(r);
      }
      const id = query._id;
      if (typeof id === 'string') {
        wheres.push('_id = ?');
        params.push(id);
      }
      const coll = query.collection;
      if (typeof coll === 'string') {
        wheres.push('_collection = ?');
        params.push(coll);
      }
      const mid = query.mid;
      if (typeof mid === 'number') {
        wheres.push('_mid = ?');
        params.push(mid);
      }
      const version = query.version;
      if (typeof version === 'number') {
        wheres.push('_version = ?');
        params.push(version);
      }
    }
    return {
      sql: wheres.length ? ' WHERE ' + wheres.join(' AND ') : '',
      params,
    };
  }

  private fetchMatching(query: any): Doc[] {
    const { sql, params } = this.prefilter(query);
    const stmt = this.db.prepare(
      `SELECT _id, __s, __refid, createdAt, updatedAt, data FROM documents${sql}`
    );
    const rows = stmt.all(...params) as unknown as RawRow[];
    const out: Doc[] = [];
    for (const r of rows) {
      let parsed: Doc;
      try {
        parsed = JSON.parse(r.data);
      } catch {
        continue;
      }
      const doc: Doc = {
        ...parsed,
        _id: r._id,
        __s: r.__s ?? parsed.__s ?? undefined,
        __refid: r.__refid ?? parsed.__refid ?? undefined,
      };
      if (this.timestampData) {
        if (r.createdAt != null) doc.createdAt = new Date(r.createdAt);
        else if (parsed.createdAt != null) doc.createdAt = new Date(parsed.createdAt);
        if (r.updatedAt != null) doc.updatedAt = new Date(r.updatedAt);
        else if (parsed.updatedAt != null) doc.updatedAt = new Date(parsed.updatedAt);
      }
      if (doc.__s === undefined) delete doc.__s;
      if (doc.__refid === undefined) delete doc.__refid;
      if (matchClause(doc, query)) out.push(doc);
    }
    return out;
  }

  findAsync<T = Doc>(query: any, _projection?: any): Cursor<T> {
    return new Cursor<T>(() => this.fetchMatching(query) as T[]);
  }

  async findOneAsync<T = Doc>(query: any, _projection?: any): Promise<T | null> {
    const docs = this.fetchMatching(query);
    return (docs.length > 0 ? (docs[0] as T) : null) as any;
  }

  async countAsync(query: any): Promise<number> {
    return this.fetchMatching(query).length;
  }

  async insertAsync<T = Doc>(rawDoc: any): Promise<T> {
    const now = Date.now();
    const doc: Doc = { ...rawDoc };
    if (!doc._id) doc._id = generateId();
    if (this.timestampData) {
      if (doc.createdAt === undefined) doc.createdAt = new Date(now).toISOString();
      if (doc.updatedAt === undefined) doc.updatedAt = new Date(now).toISOString();
    }
    const __s = typeof doc.__s === 'string' ? doc.__s : null;
    const __refid = typeof doc.__refid === 'string' ? doc.__refid : null;
    const ts = parseTs(doc.createdAt) ?? now;
    const uts = parseTs(doc.updatedAt) ?? ts;

    const persist: Doc = { ...doc };
    delete persist._id;
    delete persist.__s;
    delete persist.__refid;
    delete persist.createdAt;
    delete persist.updatedAt;

    this.db
      .prepare(
        `INSERT INTO documents (_id, __s, __refid, createdAt, updatedAt, data) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(doc._id, __s, __refid, ts, uts, JSON.stringify(persist));
    return doc as T;
  }

  async updateAsync<T = Doc>(
    query: any,
    update: any,
    options: { upsert?: boolean; multi?: boolean; returnUpdatedDocs?: boolean } = {}
  ): Promise<any> {
    const matched = this.fetchMatching(query);
    const targets = options.multi ? matched : matched.slice(0, 1);

    if (targets.length === 0) {
      if (options.upsert) {
        const seed: Doc = {};
        for (const k of Object.keys(query)) {
          const v = query[k];
          if (k.startsWith('$')) continue;
          if (isPlainObject(v) || v instanceof RegExp) continue;
          seed[k] = v;
        }
        const upd = applyUpdate(seed, update);
        const inserted = await this.insertAsync(upd);
        return options.returnUpdatedDocs ? [inserted] : 1;
      }
      return options.returnUpdatedDocs ? [] : 0;
    }

    const updated: Doc[] = [];
    const updateStmt = this.db.prepare(
      `UPDATE documents SET __s = ?, __refid = ?, createdAt = ?, updatedAt = ?, data = ? WHERE _id = ?`
    );
    this.transaction(() => {
      for (const doc of targets) {
        const next = applyUpdate(doc, update);
        if (this.timestampData) next.updatedAt = new Date().toISOString();
        const __s = typeof next.__s === 'string' ? next.__s : null;
        const __refid = typeof next.__refid === 'string' ? next.__refid : null;
        const cts = parseTs(next.createdAt) ?? null;
        const uts = parseTs(next.updatedAt) ?? Date.now();

        const persist: Doc = { ...next };
        delete persist._id;
        delete persist.__s;
        delete persist.__refid;
        delete persist.createdAt;
        delete persist.updatedAt;

        updateStmt.run(__s, __refid, cts, uts, JSON.stringify(persist), doc._id);
        updated.push(next);
      }
    });

    return options.returnUpdatedDocs ? (options.multi ? updated : updated[0]) : updated.length;
  }

  async removeAsync(query: any, options: { multi?: boolean } = {}): Promise<number> {
    const matched = this.fetchMatching(query);
    const targets = options.multi ? matched : matched.slice(0, 1);
    if (targets.length === 0) return 0;
    const stmt = this.db.prepare(`DELETE FROM documents WHERE _id = ?`);
    this.transaction(() => {
      for (const d of targets) stmt.run(d._id);
    });
    return targets.length;
  }
}

function generateId(): string {
  return randomBytes(8).toString('hex').toUpperCase();
}

function parseTs(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  return null;
}
