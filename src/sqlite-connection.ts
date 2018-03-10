import Sqlite from 'better-sqlite3';
import {AbstractConnection, IStatement, IRunResult, IConnectionOptions} from "./connection";
import {Database, SqlBoundParams} from "./index";

export interface ISqliteConnectionOptions extends IConnectionOptions {
  filename: string;
  shouldCreate?: boolean;
  inMemory?: boolean;
}

export class SqliteStatement implements IStatement {
  constructor(protected _stmt: any) {

  }

  async all(): Promise<any[]> {
    return this._stmt.all();
  }

  async get(): Promise<any> {
    return this._stmt.get();
  }

  async run(): Promise<IRunResult> {
    return this._stmt.run();
  }
}

export class SqliteConnection extends AbstractConnection<ISqliteConnectionOptions> {
  /**
   * By default, new database file will be created if no database file exists.
   * If options.shouldCreate is false, the function is going to fail on missing database file.
   * @param {ISqliteConnectionOptions} options Connection options
   */
  constructor(options: ISqliteConnectionOptions) {
    super(Object.assign({}, {
      filename: ':memory:',
      shouldCreate: false,
      inMemory: false
    } as ISqliteConnectionOptions, options || {}));
  }

  async connect(): Promise<void> {
    if (this._options.filename.toLowerCase() === ':memory:') {
      this._options.inMemory = true;
      this._options.filename = 'memdb' + new Date().getTime() + (Math.random() * (10000 - 1) + 1);
    }

    this._db = new Sqlite(this._options.filename, {
      memory: this._options.inMemory,
      fileMustExist: !this._options.shouldCreate
    });

    this._db.exec('PRAGMA foreign_keys = TRUE');
  }

  async disconnect(): Promise<void> {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  async prepare(sql: string, bindings?: SqlBoundParams | any[]): Promise<SqliteStatement> {
    if (!this._db) {
      throw new Error("No connection to database")
    }

    this._logQuery(sql, bindings);

    let prepared = this._db.prepare(sql);
    if (bindings != null) {
      prepared = prepared.bind(bindings instanceof SqlBoundParams ? bindings.sqlBindings : bindings);
    }

    return new SqliteStatement(prepared);
  }

  get connected(): boolean {
    return this._db != null;
  }

  async exec(sql: string): Promise<void> {
    if (!this._db) {
      throw new Error("No connection to database");
    }

    this._db.exec(sql);
  }

  static async createDb(options?: ISqliteConnectionOptions|string): Promise<Database> {
    if (options == null) {
      options = ':memory:';
    }
    const conn = new SqliteConnection(typeof options === 'string' ? {
      filename: options
    } : options);
    await conn.connect();
    return Database.fromConnection(conn);
  }

  protected _db: Sqlite|null = null;
}
