import {SqlBoundParams} from "./index";

export interface IConnectionOptions { }

export interface IRunResult {
  changes: number;
  lastInsertROWID: number;
}

export interface IStatement {
  run(): Promise<IRunResult>;
  get(): Promise<any>;
  all(): Promise<any[]>;
}

export abstract class AbstractConnection<OptionsType extends IConnectionOptions = any> {
  constructor(options: OptionsType) {
    this._options = options;
  }

  public abstract async connect(): Promise<void>;
  public abstract async disconnect(): Promise<void>;
  public abstract async prepare(sql: string, bindings?: SqlBoundParams|any[]): Promise<IStatement>;
  public abstract get connected(): boolean;
  public abstract async exec(sql: string): Promise<void>;

  protected _logQuery(query: string, bound?: SqlBoundParams|any[]): void {
    console.log('Q:', query, bound == null ? '' : (bound instanceof SqlBoundParams ? bound.sqlBindings : bound));
  }

  protected _options: OptionsType;
}
