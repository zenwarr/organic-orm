import {capitalize, isAlphaCode, isDigitCode, mapFromObject} from "./helpers";
import {AbstractConnection, IRunResult, IStatement} from "./connection";

const ROWID = 'rowid';

/**
 * Base class for all instances of database-mapped objects.
 */
export class DatabaseInstance<T> {
  constructor(db: Database, model: Model<T>) {
    this.$d = {
      db: db,
      model: model,
      fields: new Map(),
      created: false,
      rowId: null,
      relations: new Map()
    };
  }

  /**
   * Database this instance is linked to.
   * @returns {Database}
   */
  get $db(): Database { return this.$d.db }

  /**
   * Model of this instance
   * @returns {Model<T>}
   */
  get $model(): Model<T> { return this.$d.model; }

  /**
   * Synchronizes the instance object with database.
   * If object was created using 'Model.build', new row will be inserted into database.
   * If object was already created, it is going to be updated.
   * @param {string[]} updateFields List of fields to updated.
   * Used only when updating the instance.
   * If omitted, all fields are going to be updated.
   * If specified, only these fields are going to be updated in database.
   * @returns {Promise<void>} Fulfilled when done
   */
  async $flush(updateFields?: string[]): Promise<void> {
    if (this.$created) {
      return this.$db.updateInstance(this, updateFields);
    } else {
      await this.$db.createInstance(this);
      this.$d.created = true;
    }
  }

  /**
   * Removes the instance from database.
   * @returns {Promise<void>}
   */
  async $remove(): Promise<void> {
    await this.$db.removeInstance(this);
    this.$d.created = false;
    this.$d.rowId = null;
  }

  /**
   * Whether the instance has been flushed into a database.
   * If object has already been removed, this value is false.
   */
  get $created(): boolean { return this.$d.created; }
  set $created(value: boolean) { this.$d.created = value; }

  /**
   * Implicit row id.
   * If instance is not flushed into a database, this value is null.
   * If object has already been removed, this value is null.
   * Otherwise, it has some unique value.
   */
  get $rowId(): any { return this.$d.rowId; }
  set $rowId(value: any) {
    this.$d.rowId = value;
    if (this.$fields.has(this.$model.getPrimaryKeyName())) {
      this.$fields.set(this.$model.getPrimaryKeyName(), value);
    }
  }

  /**
   * Map of all fields of the instance.
   * @returns {Map<string, any>} Map of <field name>: <field value>
   */
  get $fields(): Map<string, any> {
    return this.$d.fields;
  }

  get $relations(): Map<string, Relation> { return this.$d.relations; }

  $get(prop: string): any {
    if (this.$fields.has(prop)) {
      return this.$fields.get(prop);
    } else if (this.$relations.has(prop)) {
      return this.$relations.get(prop);
    } else {
      return undefined;
    }
  }

  $set(prop: string, value: any): boolean {
    if (this.$relations.has(prop)) {
      return false;
    } else {
      this.$fields.set(prop, value);
      let fsw = this.$model.getFieldWrapper(prop);
      if (fsw && fsw.fieldSpec.primaryKey === true) {
        this.$rowId = value;
      }
      return true;
    }
  }

  $has(prop: string): boolean {
    return this.$fields.has(prop) || this.$relations.has(prop)
  }

  /** Protected area **/

  protected $d: {
    db: Database,
    model: Model<T>,
    fields: Map<string, any>,
    created: boolean,
    rowId: any,
    relations: Map<string, Relation>
  };
}

export type Instance<T> = T & DatabaseInstance<T>;

/**
 * Objects implementing this interface are added to DatabaseInstance objects and allow to manipulate relations.
 */
export interface Relation {
  name: string;
  relationData: RelationFieldData;
}

/**
 * This interface allows to manipulate relations which link an instance to a single instance of companion model.
 */
export interface SingleRelation<T, R> extends Relation {
  get(): Promise<Instance<R>|null>;
  link(related: Instance<R>): Promise<void>;
  linkByPK(pk: any): Promise<void>;
  unlink(): Promise<void>;
}

/**
 * This interface allows to manipulate relations which link an instance to multiple instances of companion model.
 */
export interface MultiRelation<T, R, RR> extends Relation {
  linkUsing(value: Instance<R>, relationTemplate: { [name: string]: any }): Promise<void>;
  link(...values: Instance<R>[]): Promise<void>;
  linkByPKUsing(pk: any, relationTemplate: { [name: string]: any }): Promise<void>;
  linkByPK(...pks: any[]): Promise<void>;
  unlink(...values: Instance<R>[]): Promise<void>;
  unlinkByPK(...pks: any[]): Promise<void>;
  unlinkWhere(where: WhereCriterion): Promise<void>;
  unlinkAll(): Promise<void>;
  find(options?: FindOptions): Promise<FindRelationResult<R, RR>>;
}

/**
 * Options for new one-to-one and many-to-one relations.
 */
export interface SingleRelationOptions {
  foreignKey?: string;
  companionField?: string;
}

/**
 * Options for new one-to-many and many-to-many relations.
 */
export interface MultiRelationOptions {
  model?: Model<any>|string;
  leftForeignKey?: string;
  rightForeignKey?: string;
  companionField?: string;
}

/**
 * Supported relation types
 */
export enum RelationType {
  OneToOne,
  ManyToOne,
  OneToMany,
  ManyToMany
}

/**
 * There objects are used to store information about relations.
 * Each model contains a list of these objects -- one for each accessible relation.
 * A companion model can also have a RelationFieldData object referring to the same logical relation.
 */
export abstract class RelationFieldData {
  name: string;
  type: RelationType;
  model: Model<any>;
  companionModel: Model<any>;
  isLeft: boolean;

  constructor(public resultsInMany: boolean) {

  }

  /**
   * Builds SQL join condition.
   * @param {Model<any>} model Model on which we are doing select query.
   * This model can be either current model or the relation model (if any).
   * @param {string} companionAlias Alias of companion model.
   * This model can be either companion model or the relation model (if any)
   * @param joinModel Model we are going to join.
   * @returns {string}
   */
  abstract getJoinCondition(model: Model<any>, companionAlias: string, joinModel: Model<any>): string;
  abstract createAccesser(inst: Instance<any>): Relation;
}

class SingleRelationFieldData extends RelationFieldData {
  constructor(public name: string, public type: RelationType, public model: Model<any>,
              public companionModel: Model<any>, public isLeft: boolean,
              public foreignKey: string) {
    super(false);
  }

  get isCompanion(): boolean {
    return this.type === RelationType.OneToOne && !this.isLeft;
  }

  getJoinCondition(model: Model<any>, companionAlias: string, joinModel: Model<any>): string {
    if (model !== this.model || joinModel !== this.companionModel) {
      throw new ModelMismatchError();
    }

    let companionPk = this.companionModel.getPrimaryKeyName();
    if (!this.isCompanion) {
      return `${companionAlias}.${companionPk} = ${this.model.name}.${this.foreignKey}`;
    } else {
      return `${companionAlias}.${this.foreignKey} = ${this.model.name}.${this.model.getPrimaryKeyName()}`;
    }
  }

  createAccesser(inst: Instance<any>): Relation {
    return new DbSingleRelation(inst, this);
  }
}

class ManyRelationFieldData extends RelationFieldData {
  constructor(public name: string, public type: RelationType, public model: Model<any>,
              public companionModel: Model<any>, public isLeft: boolean,
              public foreignKey: string) {
    super(true);
  }

  getJoinCondition(model: Model<any>, companionAlias: string, joinModel: Model<any>): string {
    if (model !== this.model || joinModel !== this.companionModel) {
      throw new ModelMismatchError();
    }

    return `${companionAlias}.${this.foreignKey} = ${this.model.name}.${this.model.getPrimaryKeyName()}`;
  }

  createAccesser(inst: Instance<any>): Relation {
    return new DbManyRelation(inst, this);
  }
}

class MultiRelationFieldData extends RelationFieldData {
  constructor(public name: string, public type: RelationType, public model: Model<any>,
              public companionModel: Model<any>, public isLeft: boolean,
              public relationModel: Model<any>, public leftForeignKey: string,
              public rightForeignKey: string) {
    super(true);
  }

  getJoinCondition(model: Model<any>, companionAlias: string, joinModel: Model<any>): string {
    if (joinModel !== this.relationModel && joinModel !== this.companionModel) {
      throw new ModelMismatchError();
    }

    if (model === this.model) {
      if (joinModel === this.relationModel) {
        let pk = this.model.getPrimaryKeyName();
        return `${companionAlias}.${this.myForeignKey} = ${this.model.name}.${pk}`
      } else if (joinModel === this.companionModel) {
        let pk = this.companionModel.getPrimaryKeyName();
        return `${companionAlias}.${pk} IN (SELECT ${this.otherForeignKey} FROM ${this.relationModel.name} WHERE ${this.myForeignKey} = ${this.model.name}.${this.model.getPrimaryKeyName()})`;
      } else {
        throw new ModelMismatchError();
      }
    } else if (model === this.relationModel && joinModel === this.companionModel) {
      let pk = this.companionModel.getPrimaryKeyName();
      return `${companionAlias}.${pk} = ${this.relationModel.name}.${this.otherForeignKey}`;
    } else {
      throw new ModelMismatchError();
    }
  }

  get myForeignKey(): string {
    return this.isLeft ? this.leftForeignKey : this.rightForeignKey;
  }

  get otherForeignKey(): string {
    return this.isLeft ? this.rightForeignKey : this.leftForeignKey;
  }

  createAccesser(inst: Instance<any>): Relation {
    return new DbMultiRelation(inst, this);
  }
}

/**
 * The error thrown when a client tries to link instances of wrong models.
 */
class ModelMismatchError extends Error {
  constructor() {
    super('Cannot create a relation: an instance given has incorrect model')
  }
}

/**
 * The error thrown when a client tries to link instances that are not flushed to database or in other ways invalid.
 */
class InstanceInvalidError extends Error {
  constructor() {
    super('Cannot link an instance: primary key is invalid or instance not flushed');
  }
}

/**
 * Each derivative of this class is intended to manage a specific implementation of relation in SQL database.
 * Objects of this class are added to database instances and implement corresponding interfaces.
 * There can be three types of relations from SQL point of view
 *  - single (DbSingleRelation): an instance linked to a single instance of companion model,
 *      and either companion's foreign key is stored in current model or vise versa.
 *  - many (DbManyRelation): an instance linked to multiple instances of companion model,
 *      and companion model stores foreign keys pointing to the current model.
 *  - multi (DbMultiRelation): an extra table is created which stores pairs of foreign keys for both
 *      current and companion instances. Therefore, an instance linked to multiple instances of companion
 *      model.
 */
class DbRelation<T> {
  constructor(inst: DatabaseInstance<T>) {
    this._inst = inst;
  }

  protected _ensureGood(): void {
    if (this._inst.$rowId == null || !this._inst.$created) {
      throw new InstanceInvalidError();
    }
  }

  protected _ensureRelatedInstancesGood(instances: DatabaseInstance<any>[], expectedModel: Model<any>): void {
    for (let inst of instances) {
      if (!inst.$created || inst.$rowId == null) {
        throw new InstanceInvalidError();
      }
      if (inst.$model !== expectedModel) {
        throw new ModelMismatchError();
      }
    }
  }

  protected _ensureRelatedPksGood(pks: any[]): void {
    for (let pk of pks) {
      if (pk == null) {
        throw new InstanceInvalidError();
      }
    }
  }

  /** Protected area **/

  protected _inst: DatabaseInstance<T>;
}

/**
 * Handles one-to-one relationships for both sides, many-to-one for left side and one-to-many for right side.
 * In all cases, the model that has DbSingleRelation attached, stores primary key value of companion model.
 * A single exception is one-to-one relationship where DbSingleRelation is attached to right side model.
 * In this case isCompanion flag is true, and its companion model stores the primary key of the current model.
 */
class DbSingleRelation<T, R> extends DbRelation<T> implements SingleRelation<T, R> {
  constructor(inst: DatabaseInstance<T>, d: SingleRelationFieldData) {
    super(inst);
    this._d = d;
  }

  /**
   * Gets the instance linked to the current model.
   * @returns {Promise<Instance<R>>} Linked instance or null if no instance linked.
   */
  async get(): Promise<Instance<R>|null> {
    this._ensureGood();
    if (!this._d.isCompanion) {
      // just find a companion instance by its primary key
      let fk = this._inst.$get(this._d.foreignKey);
      return fk == null ? null : this._d.companionModel.findByPK(fk);
    } else {
      // we should find an instance which foreign key is equal to our primary key
      if (!this._inst.$rowId == null || !this._inst.$created) {
        return null;
      } else {
        return this._d.companionModel.findOne({
          where: {
            [this._d.foreignKey]: this._inst.$rowId
          }
        });
      }
    }
  }

  /**
   * Links an existing instance to the current instance.
   * @param {Instance<R>} related Model to link to
   * @returns {Promise<void>} Fulfilled when done
   */
  async link(related: Instance<R>): Promise<void> {
    this._ensureRelatedInstancesGood([related], this._d.companionModel);
    return this.linkByPK(related.$rowId);
  }

  /**
   * Same as link, but does not require creating and fetching an instance to link if you know its primary key value.
   * @param pk Primary key value of instance to link.
   * @returns {Promise<void>} Fulfilled when done
   */
  async linkByPK(pk: any): Promise<void> {
    this._ensureRelatedPksGood([pk]);
    if (!this._d.isCompanion) {
      // just set our foreign key to the primary key of an item we want to link
      this._inst.$set(this._d.foreignKey, pk);
      return this._inst.$flush([ this._d.foreignKey ]);
    } else {
      // set a foreign key on the related instance to the value of our primary key
      let related = await this._d.companionModel.findByPK(pk);
      if (related == null) {
        throw new Error('Cannot create a relation: no instance with given primary key found');
      }
      related.$set(this._d.foreignKey, this._inst.$rowId);
      return related.$flush([ this._d.foreignKey ]);
    }
  }

  /**
   * Unlink the currently linked instance.
   * If no instance linked, does nothing.
   * @returns {Promise<void>} Fulfilled when done
   */
  async unlink(): Promise<void> {
    this._ensureGood();

    if (!this._d.isCompanion) {
      this._inst.$set(this._d.foreignKey, null);
      return this._inst.$flush([ this._d.foreignKey ]);
    } else {
      return this._d.companionModel.update({
        where: {
          [this._d.foreignKey]: this._inst.$rowId
        },
        set: {
          [this._d.foreignKey]: null
        }
      });
    }
  }

  get name(): string { return this._d.name; }

  get relationData(): RelationFieldData { return this._d; }

  /** Protected area **/

  protected _d: SingleRelationFieldData;
}

/**
 * Handles one-to-many for left side and many-to-one for right side.
 * In all cases, the companion model stores primary indexes of instances of this model and this primary key can be repeated.
 */
class DbManyRelation<T, R> extends DbRelation<T> implements MultiRelation<T, R, void> {
  constructor(inst: DatabaseInstance<T>, d: ManyRelationFieldData) {
    super(inst);
    this._d = d;
  }

  get name(): string { return this._d.name; }

  async link(...instances: Instance<R>[]): Promise<void> {
    this._ensureGood();
    this._ensureRelatedInstancesGood(instances, this._d.companionModel);

    return this.linkByPK(...instances.map(x => x.$rowId));
  }

  async linkByPK(...pks: any[]): Promise<void> {
    this._ensureGood();
    this._ensureRelatedPksGood(pks);

    await this._d.companionModel.update({
      where: {
        [this._d.companionModel.getPrimaryKeyName()]: {
          $in: pks
        }
      },
      set: {
        [this._d.foreignKey]: this._inst.$rowId
      }
    });
  }

  linkUsing(value: Instance<R>): Promise<void> {
    return this.link(value);
  }

  linkByPKUsing(pk: any): Promise<void> {
    return this.linkByPK(pk);
  }

  async unlink(...values: Instance<R>[]): Promise<void> {
    this._ensureGood();
    this._ensureRelatedInstancesGood(values, this._d.companionModel);

    return this.unlinkByPK(...values.map(x => x.$rowId));
  }

  async unlinkByPK(...pks: any[]): Promise<void> {
    this._ensureGood();
    this._ensureRelatedPksGood(pks);

    return this._d.companionModel.update({
      where: {
        [this._d.companionModel.getPrimaryKeyName()]: {
          $in: pks
        }
      },
      set: {
        [this._d.foreignKey]: null
      }
    });
  }

  async unlinkWhere(where: WhereCriterion): Promise<void> {
    this._ensureGood();

    let crit: WhereCriterion = Object.assign({}, where);
    crit[this._d.foreignKey] = this._inst.$rowId;

    return this._d.companionModel.update({
      where: crit,
      set: {
        [this._d.foreignKey]: null
      }
    });
  }

  async unlinkAll(): Promise<void> {
    this._ensureGood();

    return this.unlinkWhere({
      where: { }
    });
  }

  async find(options?: FindOptions): Promise<FindRelationResult<R, void>> {
    this._ensureGood();

    let givenWhere = options && options.where ? options.where : {};

    let result = await this._d.companionModel.find({
      ...(options ? options : {}),
      where: {
        ...givenWhere,
        [this._d.foreignKey]: {
          $eq: this._inst.$rowId
        }
      }
    }) as FindRelationResult<R, void>;
    result.relationItems = [];
    return result;
  }

  get relationData(): RelationFieldData { return this._d; }

  /** Protected area **/

  protected _d: ManyRelationFieldData;
}

/**
 * Handles both sides for many-to-many relation.
 * This relation is implemented through extra table that stores primary keys for both models.
 */
class DbMultiRelation<T, R, RR> extends DbRelation<T> implements MultiRelation<T, R, RR> {
  constructor(inst: DatabaseInstance<T>, rd: MultiRelationFieldData) {
    super(inst);
    this._d = rd;
  }

  async link(...values: Instance<R>[]): Promise<void> {
    this._ensureGood();
    this._ensureRelatedInstancesGood(values, this._d.companionModel);

    return this.linkByPK(...values.map(x => x.$rowId));
  }

  linkUsing(value: Instance<R>, relationTemplate: { [p: string]: any }): Promise<void> {
    this._ensureGood();
    this._ensureRelatedInstancesGood([value], this._d.companionModel);

    return this.linkByPKUsing(value.$rowId, relationTemplate);
  }

  async linkByPK(...pks: any[]): Promise<void> {
    this._ensureGood();
    this._ensureRelatedPksGood(pks);

    for (let pk of pks) {
      let newRelation = this._d.relationModel.build({
        [this._d.myForeignKey]: this._inst.$rowId,
        [this._d.otherForeignKey]: pk
      });
      await newRelation.$flush();
    }
  }

  linkByPKUsing(pk: any, relationTemplate: { [p: string]: any }): Promise<void> {
    this._ensureGood();
    this._ensureRelatedPksGood([pk]);

    let newRelation = this._d.relationModel.build(Object.assign({}, relationTemplate, {
      [this._d.myForeignKey]: this._inst.$rowId,
      [this._d.otherForeignKey]: pk
    }));
    return newRelation.$flush();
  }

  async unlink(...values: Instance<R>[]): Promise<void> {
    this._ensureGood();
    this._ensureRelatedInstancesGood(values, this._d.companionModel);

    return this.unlinkByPK(values.map(x => x.$rowId));
  }

  async unlinkByPK(...pks: any[]): Promise<void> {
    this._ensureGood();
    this._ensureRelatedPksGood(pks);

    return this._d.relationModel.remove({
      where: {
        [this._d.myForeignKey]: this._inst.$rowId,
        [this._d.otherForeignKey]: {
          $in: pks
        }
      }
    });
  }

  async unlinkWhere(where: WhereCriterion): Promise<void> {
    this._ensureGood();

    let crit: WhereCriterion = Object.assign({}, where);
    crit[this._d.myForeignKey] = this._inst.$rowId;

    return this._d.relationModel.remove({
      where: crit
    });
  }

  async unlinkAll(): Promise<void> {
    this._ensureGood();

    return this._d.relationModel.remove({
      where: {
        [this._d.myForeignKey]: this._inst.$rowId
      }
    });
  }

  /**
   * Get related instances and relation instances.
   * @param {FindOptions} options Search options.
   * This object should not have join option.
   * Any other options are permitted.
   * Note that 'where' option is applied to items of companion table, not the relation table.
   * To filter results by relation table properties, use relationModelName$relationProp conditions.
   * For example:
   * foo.bars.find({ where: { name: 'some name', foobar$relationType: 1 } });
   * @returns {Promise<FindRelationResult<R, RR>>}
   */
  async find(options?: FindOptions): Promise<FindRelationResult<R, RR>> {
    if (options && options.join != null) {
      throw new Error('Cannot get list of related items: search options should not have join clause');
    }
    if (options && options.hasOwnProperty(this._d.myForeignKey)) {
      throw new Error('Cannot get list of related items: search options are invalid');
    }

    // select ... from relation inner join right on right.id = relation.rightId where right.prop = prop and relation.prop = prop

    let whereRelated: WhereCriterion = {
      [this._d.myForeignKey]: this._inst.$rowId
    };
    let where: WhereCriterion = Object.assign({}, options ? options.where : {}, whereRelated);

    // we query for items of relation table, and join them with items from companion table.
    // so result object will have relation instances as result.items and related companion instances as result.joined[some_name]
    let interResult = await this._d.relationModel.find({
      where,
      join: [ { relation: this, type: JoinType.Inner } ],
      ...options
    });

    // to transform the result to required form, we should place related companion instances to result.items,
    // instances of relation table -- to result.relatedItems.
    // no other joins should be present in result.

    let relatedItems: Instance<any>[] = interResult.joined && interResult.joined[this.name] ? interResult.joined[this.name] : [];

    return {
      totalCount: interResult.totalCount,
      items: relatedItems,
      relationItems: interResult.items
    };
  }

  get name(): string { return this._d.name; }

  get relationData(): RelationFieldData { return this._d; }

  /** Protected area **/

  protected _d: MultiRelationFieldData;
}

/**
 * ORM model class.
 */
export class Model<T> {
  /**
   * You should not create Model instances yourself.
   * Use Database.define for it.
   * @param {Database} db Database for the model
   * @param {string} name Model name (used as a table name)
   * @param {ModelSpec} spec Fields specifications
   * @param {ModelOptions} options Model options
   */
  constructor(db: Database, name: string, spec: ModelSpec, options?: ModelOptions) {
    this._db = db;
    this._name = name;
    this._options = Object.assign({}, {
      createTimestamp: false,
      updateTimestamp: false,
      defaultSorting: null
    } as ModelOptions, options);

    if (typeof this._options.defaultSorting === 'string') {
      this._options.defaultSorting = {
        by: this._options.defaultSorting,
        order: SortOrder.Asc
      };
    }

    for (let fieldName of Object.keys(spec)) {
      this.addField(fieldName, spec[fieldName]);
    }

    if (this.options.createTimestamp) {
      this.addField('createdAt', {
        typeHint: TypeHint.Date,
        newGenerate: given => given == null ? new Date() : given
      });
    }

    if (this.options.updateTimestamp) {
      this.addField('updatedAt', { typeHint: TypeHint.Date });
    }
  }

  /**
   * Database for the model
   * @returns {Database}
   */
  get db(): Database { return this._db; }

  /**
   * Field specifications for the model.
   * Note that this function returns not the specs you've provided to define, but wrappers for them.
   * Use FieldSpecWrapper.fieldSpec to access raw field specification.
   * @returns {{[p: string]: FieldSpecWrapper}} Map of field names to field specification wrappers.
   */
  get spec(): { [name: string]: FieldSpecWrapper } { return this._spec; }

  /**
   * List of all fields registered for this model.
   * @returns {FieldSpecWrapper[]} List of fields
   */
  get fields(): FieldSpecWrapper[] {
    return Object.keys(this._spec).map(key => this._spec[key]) as FieldSpecWrapper[];
  }

  get relations(): RelationFieldData[] {
    return this._relationFields;
  }

  /**
   * Model name
   * @returns {string} Model name
   */
  get name(): string { return this._name; }

  /**
   * Model options that were used to define the model
   * @returns {ModelOptions} Model options
   */
  get options(): ModelOptions { return this._options; }

  get defaultSorting(): SortProp|null { return this._options.defaultSorting as SortProp|null; }

  /**
   * Defined model constraints.
   * @returns {string[]} List of constrants
   */
  get constraints(): string[] { return this._constraints; }

  /**
   * Returns raw field spec for the field with given name.
   * @param {string} fieldName Name of the field you are interested in
   * @returns {FieldSpec} Raw field spec (the one you've provided to Database.define)
   */
  getFieldSpec(fieldName: string): FieldSpec|null {
    return this._spec[fieldName] == null ? null : this._spec[fieldName].fieldSpec;
  }

  /**
   * Returns field spec wrapper for the field with given name.
   * @param {string} name Name of the field you are interested in
   * @returns {FieldSpecWrapper} Field spec
   */
  getFieldWrapper(name: string): FieldSpecWrapper|null {
    return this._spec[name] || null;
  }

  /**
   * Just list getField wrapper, but throws an error instead of returning null
   * @param {string} name Name of the field you are interested in
   * @returns {FieldSpecWrapper} Field spec
   */
  getFieldWrapperChecked(name: string): FieldSpecWrapper {
    let fw = this.getFieldWrapper(name);
    if (fw == null) {
      throw new Error(`No field named [${name}] found. We have only the following fields: ${this.fields.map(x => x.fieldName)}`);
    }
    return fw;
  }

  /**
   * Adds a new field to the model.
   * @param {string} fieldName Name of the field to add.
   * @param {FieldSpec} fieldSpec Field specification
   * @returns {Model<T>} This model
   */
  addField(fieldName: string, fieldSpec: FieldSpec): Model<T> {
    if (!isValidName(fieldName)) {
      throw new Error(`Cannot define field: [${fieldName}] is invalid name for a field`);
    }
    if (this._spec[fieldName] != null) {
      throw new Error(`Field with same name [${fieldName}] already exists`);
    }
    this._spec[fieldName] = new FieldSpecWrapper(fieldName, fieldSpec);
    return this;
  }

  /**
   * Returns name of the primary key field.
   * If no primary key field defined, implicit sqlite primary key column name is returned.
   * If two or more fields are marked as primary, it is undefined which one is going to be returned (because this class does not support compound primary keys).
   * @returns {string|null} Primary key field name
   */
  getPrimaryKeyName(): string {
    let primary = this.fields.find(fsw => fsw.fieldSpec.primaryKey === true);
    return primary == null ? ROWID : primary.fieldName;
  }

  /**
   * If no field with fieldName exists for the model, new field will be added, just like addField would do.
   * If the field already exists, it changes its spec properties to ones provided in fieldSpec.
   * The properties not mentioned in fieldSpec argument are not changed.
   * @param {string} fieldName Name of the field to update.
   * @param {FieldSpec} fieldSpec New field specification or spec properties to update
   * @returns {Model<T>} This model
   */
  updateField(fieldName: string, fieldSpec: FieldSpec): Model<T> {
    if (this._spec[fieldName] == null) {
      // add a new field instead of updating
      this.addField(fieldName, fieldSpec);
    } else {
      let oldFieldSpec = this._spec[fieldName].fieldSpec;
      for (let k of Object.keys(fieldSpec)) {
        (oldFieldSpec as any)[k] = (fieldSpec as any)[k];
      }
    }
    return this;
  }

  /**
   * Creates a new one-to-one relation with another model.
   * Relation is implemented via adding a new field to this model which references an instance of another model.
   * @param {Model<any>} otherModel A model to add the relation to
   * @param {string} field Field which will be used to access the relation
   * @param {string} options Relation options
   * @returns {Model<T>} This model
   */
  oneToOne(otherModel: Model<any>|string, field?: string|null, options?: SingleRelationOptions): Model<T> {
    return this._oneOrManyToOne(otherModel, field, options, RelationType.OneToOne);
  }

  /**
   * Creates a new many-to-one relation with another model.
   * It works just like one-to-one relation, but relation field is not unique.
   * @param {Model<any>} otherModel A model to add the relation to
   * @param {string} field A field which will be used to access the relation
   * @param {string} options Relation options
   * @returns {Model<T>} This model
   */
  manyToOne(otherModel: Model<any>|string, field?: string|null, options?: SingleRelationOptions): Model<T> {
    return this._oneOrManyToOne(otherModel, field, options, RelationType.ManyToOne);
  }

  /**
   * Creates a new one-to-many relation with another model.
   * Relation is implemented like it would be one-to-many relation on otherModel with this model.
   * @param {Model<any>} otherModel A model to add the relation to
   * @param {string} field A field to be used to access the relation
   * @param {string} options Relation options
   * @returns {Model<T>} This model
   */
  oneToMany(otherModel: Model<any>|string, field?: string|null, options?: SingleRelationOptions): Model<T> {
    if (typeof otherModel === 'string') {
      let m = this._db.getModel(otherModel);
      if (m == null) {
        throw new Error(`Cannot create relation: no model named [${otherModel}] defined`);
      }
      otherModel = m;
    }

    otherModel._oneOrManyToOne(this, options && options.companionField ? options.companionField : null, {
      foreignKey: options && options.foreignKey ? options.foreignKey : undefined,
      companionField: field == null ? undefined : field
    }, RelationType.OneToMany, true);

    return this;
  }

  /**
   * Creates a new many-to-many relation with another model.
   * This relation is implemented by creating a relation table which stores pairs of foreign keys to both models.
   * @param {Model<any>} otherModel A model to add the relation to
   * If no model with the provided name exist, new one will be created.
   * You can use an existing model to make the relation table have other fields.
   * @param field A field to be used to access the relation
   * @param options Relation options
   * @returns {Model<T>} This model
   */
  manyToMany(otherModel: Model<any>|string, field?: string|null, options?: MultiRelationOptions): Model<T> {
    // resolve other model
    if (typeof otherModel === 'string') {
      let m = this._db.getModel(otherModel);
      if (m == null) {
        throw new Error(`Cannot create relation: no model named [${otherModel}] defined`);
      }
      otherModel = m;
    }

    // find model to be used as a relation table
    let relationModel: Model<any>|null = null;
    if (options && options.model && typeof options.model !== 'string') {
      // use provided model for it
      relationModel = options.model;
    } else {
      // create a new model for relation
      let relModelName: string;
      if (options && options.model && typeof options.model === 'string') {
        // if model name is provided, use it
        relModelName = options.model;
        let existingRelModel = this._db.getModel(relModelName);
        if (existingRelModel != null) {
          relationModel = existingRelModel;
        }
      } else {
        // generate a name for relation model
        relModelName = this.name + capitalize(otherModel.name);
      }

      if (relationModel == null) {
        relationModel = this._db.define(relModelName, { });
      }
    }

    // initalize relation table, add fields and constraints
    let leftForeignKey = options && options.leftForeignKey ? options.leftForeignKey : this.name + 'id';
    let rightForeignKey = options && options.rightForeignKey ? options.rightForeignKey : otherModel.name + 'id';

    relationModel.updateField(leftForeignKey, { typeHint: TypeHint.Integer });
    relationModel.updateField(rightForeignKey, { typeHint: TypeHint.Integer });
    relationModel.addForeignKeyConstraint(leftForeignKey, this, this.getPrimaryKeyName());
    relationModel.addForeignKeyConstraint(rightForeignKey, otherModel, otherModel.getPrimaryKeyName());
    relationModel.addUniqueConstraint([leftForeignKey, rightForeignKey]);

    // add relation field to manipulate the relation
    if (field) {
      this._addRelationField(new MultiRelationFieldData(
          field,
          RelationType.ManyToMany,
          this,
          otherModel,
          true,
          relationModel,
          leftForeignKey,
          rightForeignKey
      ));
    }

    if (options && options.companionField) {
      otherModel._addRelationField(new MultiRelationFieldData(
          options.companionField,
          RelationType.ManyToMany,
          otherModel,
          this,
          false,
          relationModel,
          leftForeignKey,
          rightForeignKey
      ));
    }

    return this;
  }

  /**
   * Adds a new constraint to the model
   * @param {string} constr Constraint text
   * @returns {Model<T>} This model
   */
  addConstraint(constr: string): Model<T> {
    this._constraints.push(constr);
    return this;
  }

  /**
   * A shortcut for addConstraint that adds a new foreign key constraint.
   * @param {string} ownKey Name of a field on the current model
   * @param {Model<any> | string} foreignModel Name of other model
   * @param {string} foreignKeys Key (or keys, separated by commas) of other model
   * @returns {Model<T>} This model
   */
  addForeignKeyConstraint(ownKey: string, foreignModel: Model<any>|string, foreignKeys: string): Model<T> {
    let modelName = typeof foreignModel === 'string' ? foreignModel : foreignModel.name;
    this.addConstraint(`FOREIGN KEY (${ownKey}) REFERENCES ${modelName}(${foreignKeys}) ON UPDATE CASCADE ON DELETE CASCADE`);
    return this;
  }

  /**
   * A shortcut for addConstraint that adds a new UNIQUE constraint.
   * This function is most useful when you want to make a compound unique constraint.
   * Do not use this function to make a single field unique.
   * Set 'unique' flag on the field's spec to make it unique.
   * @param {(string | FieldSpecWrapper)[]} fields List of keys that should be unique.
   * @returns {Model<T>} This model
   */
  addUniqueConstraint(fields: (string|FieldSpecWrapper)[]): Model<T> {
    let keys: string[] = fields.map(x => typeof x === 'string' ? x : x.fieldName);
    this.addConstraint(`UNIQUE(${keys.join(', ')})`);
    return this;
  }

  /**
   * Creates a new instance for the model.
   * Does not store anything into the database.
   * You should call $create on the created instance to write changes.
   * @param {{[name: string]: any}} template Properties of the new instance.
   * @returns {Instance<T>} New instance.
   * This instance has all properties that correspond to the fields of the model, plus DatabaseInstance methods that start with $.
   */
  build(template: { [name: string]: any }): Instance<T> {
    let inst = new DatabaseInstance(this._db, this);
    for (let field of this.fields) {
      let given = template[field.fieldName];
      if (given == null && field.fieldSpec.newGenerate != null) {
        given = field.fieldSpec.newGenerate(given);
      }
      if (given == null) {
        given = null;
      }
      inst.$fields.set(field.fieldName, given);
    }

    return this._makeInstance(inst);
  }

  /**
   * Creates an instance from database query result.
   * Should not by used by end user.
   * @param {{[p: string]: any}} sqlResult Sql result
   * @param {string} prefix Table prefix for instance data
   * @returns {Instance<T>} Created instance
   */
  buildFromDatabaseResult(sqlResult: { [name: string]: any }, prefix?: string): Instance<T> {
    let result = new DatabaseInstance(this._db, this);
    for (let field of this.fields) {
      let value: any;
      let fieldName = prefix ? prefix + '.' + field.fieldName : field.fieldName;

      if (sqlResult.hasOwnProperty(fieldName)) {
        result.$fields.set(field.fieldName, value = field.convertFromDatabaseForm(sqlResult[fieldName]));
      } else {
        throw new Error(`No database value for field [${fieldName}] of model [${this.name}]. Result dump: ${sqlResult}`);
      }

      if (field.fieldSpec.primaryKey) {
        result.$rowId = value;
      }
    }

    if (result.$rowId == null) {
      let qualifiedRowid = this.name + '.' + ROWID;
      if (!Reflect.has(sqlResult, qualifiedRowid) && !Reflect.has(sqlResult, ROWID)) {
        throw new Error(`No rowid database value for an instance of model [${this.name}] (tried name ${qualifiedRowid} and ${ROWID})`);
      } else {
        let rowid = Reflect.has(sqlResult, ROWID) ? sqlResult[ROWID] : sqlResult[qualifiedRowid];
        if (typeof rowid !== 'number') {
          throw new Error(`Invalid rowid value type for an instance of model [${this.name}]`);
        }
        result.$rowId = rowid;
      }
    }

    result.$created = true;

    return this._makeInstance(result);
  }

  /**
   * Search instances by a criteria.
   * @param {FindOptions} options Search criteria and options
   * @returns {Promise<FindResult<T>>} Result set
   */
  async find(options?: FindOptions): Promise<FindResult<T>> {
    return this._db.find(this, options || {});
  }

  /**
   * Updates instances by given criteria, setting specified fields to given values.
   * @param {UpdateOptions} options Search criteria and options.
   * 'where' property specified search criteria.
   * 'set' property lists fields and values that updated instances will have.
   * For example:
   * model.update({
   *   where: { name: 'old name' },
   *   set: { name: 'new name' }
   * });
   * will replace all occupiences of 'old name' with 'new name'
   * @returns {Promise<void>} Fulfilled when done.
   */
  async update(options: UpdateOptions): Promise<void> {
    return this._db.update(this, options);
  }

  /**
   * Removes instances matching given criteria.
   * @param {RemoveOptions} options Search criteria.
   * 'where' property specifies search criteria.
   * You should not call the method without 'where' property to remove all instances of current model.
   * Such behaviour is prohibited for security purposes.
   * To remove all instances, explicitly use removeAll function.
   * @returns {Promise<void>} Fulfilled when done.
   */
  async remove(options: RemoveOptions): Promise<void> {
    return this._db.remove(this, options);
  }

  /**
   * Removes all instances of given model from database.
   * @returns {Promise<void>} Fulfilled when done.
   */
  async removeAll(): Promise<void> {
    return this._db.removeAll(this);
  }

  /**
   * Returns a first instance matching a query.
   * If no instances matching criteria found, null is returned.
   * @param {FindOptions} options Search criteria and options
   * @returns {Promise<Instance<T>>} Result or null if no results.
   */
  async findOne(options?: FindOptions): Promise<Instance<T> | null> {
    let results = await this._db.find(this, Object.assign({}, options, {
      limit: 1,
      fetchTotalCount: false
    } as FindOptions));
    return results.items.length > 0 ? results.items[0] : null;
  }

  /**
   * Just list findOne, but throws an error when no instances found.
   * @param {FindOptions} options Search criteria and options
   * @returns {Promise<Instance<T>>} Result
   */
  async findOneChecked(options?: FindOptions): Promise<Instance<T>> {
    let r = await this.findOne(options);
    if (r == null) {
      throw new Error('No instance matching criteria found');
    }
    return r;
  }

  /**
   * Finds and instance with given primary key.
   * @param pkValue Primary key value
   * @returns {Promise<Instance<T>>} Instance or null if no instance found
   */
  async findByPK(pkValue: any): Promise<(Instance<T>) | null> {
    let results = await this._db.find(this, {
      where: {
        [this.getPrimaryKeyName()]: pkValue
      }
    });
    return results.items.length > 0 ? results.items[0] : null;
  }

  /**
   * Just like findByPK, but throws and error instead of returning null.
   * @param pkValue Primary key value
   * @returns {Promise<Instance<T>>} Instance with given primary key
   */
  async findByPKChecked(pkValue: any): Promise<Instance<T>> {
    let r = await this.findByPK(pkValue);
    if (r == null) {
      throw new Error('No instance with given primary key found');
    }
    return r;
  }

  /**
   * Returns number of instances of this model in the database.
   * @returns {Promise<number>} Number of instances
   */
  async count(): Promise<number> {
    return this._db.count(this);
  }

  getRelationFieldData(name: string): RelationFieldData|null {
    let f = this._relationFields.find(x => x.name === name);
    return f == null ? null : f;
  }

  /** Protected area **/

  protected _db: Database;
  protected _spec: { [name: string]: FieldSpecWrapper } = {};
  protected _name: string;
  protected _constraints: string[] = [];
  protected _options: ModelOptions;
  protected _relationFields: RelationFieldData[] = [];

  protected _oneOrManyToOne(otherModel: Model<any>|string, field: string|null|undefined,
                            options: SingleRelationOptions|undefined, type: RelationType,
                            swapLeftRight: boolean = false) {
    let unique = type === RelationType.OneToOne;

    // resolve model
    if (typeof otherModel === 'string') {
      let m = this._db.getModel(otherModel);
      if (m == null) {
        throw new Error(`Cannot create a relation: model [${otherModel}] is not defined`);
      }
      otherModel = m;
    }

    // create a column to hold foreign key
    let foreignKey = options && options.foreignKey ? options.foreignKey : otherModel.name + 'id';
    if (this.getFieldSpec(foreignKey) == null) {
      this.addField(foreignKey, { typeHint: TypeHint.Integer, unique });
    } else {
      this.updateField(foreignKey, { unique });
    }

    // create constraint for the foreign key
    this.addForeignKeyConstraint(foreignKey, otherModel, otherModel.getPrimaryKeyName());

    function isMany(isLeft: boolean): boolean {
      return (type === RelationType.OneToMany && isLeft) ||
          (type === RelationType.ManyToOne && !isLeft);
    }

    if (field) {
      let ctor = isMany(!swapLeftRight) ? ManyRelationFieldData : SingleRelationFieldData;
      this._addRelationField(new ctor(
          field,
          type,
          this,
          otherModel,
          !swapLeftRight,
          foreignKey
      ));
    }

    if (options && options.companionField) {
      let ctor = isMany(swapLeftRight) ? ManyRelationFieldData : SingleRelationFieldData;
      otherModel._addRelationField(new ctor(
          options.companionField,
          type,
          otherModel,
          this,
          swapLeftRight,
          foreignKey
      ));
    }

    return this;
  }

  protected _checkRelationFieldName(name: string): void {
    if (!isValidName(name)) {
      throw new Error(`Cannot create a relation: [${name}] is invalid name for a field`);
    } else if (this.getFieldSpec(name) != null || this.getRelationFieldData(name) != null) {
      throw new Error(`Cannot create a relation: field [${name}] is already reserved`);
    }
  }

  protected _addRelationField(d: RelationFieldData): void {
    this._checkRelationFieldName(d.name);
    this._relationFields.push(d);
  }

  protected _makeInstance(inst: DatabaseInstance<T>): Instance<T> {
    // initialize relations for the instance
    for (let relation of this._relationFields) {
      inst.$relations.set(relation.name, relation.createAccesser(inst));
    }

    return new Proxy(inst, {
      get: function(target: DatabaseInstance<T>, name: string): any {
        if (!(typeof name === 'string') || name.startsWith('$') || Reflect.has(target, name)) {
          return Reflect.get(target, name, target);
        } else {
          return target.$get(name);
        }
      },
      set: function(target: DatabaseInstance<T>, name: string, value: any): boolean {
        if (!(typeof name === 'string') || name.startsWith('$') || Reflect.has(target, name)) {
          return Reflect.set(target, name, value, target);
        } else {
          return target.$set(name, value);
        }
      },
      has: function(target: DatabaseInstance<T>, prop: string): boolean {
        return ((typeof prop !== 'string' || prop.startsWith('$')) && Reflect.has(target, prop)) ||
            target.$has(prop);
      }
    }) as Instance<T>;
  }
}

/**
 * Model specification that a client gives to Database.define.
 * It is basically an object map of all fields.
 */
export interface ModelSpec {
  [name: string]: FieldSpec;
}

/**
 * Specification of a single field.
 */
export interface FieldSpec {
  validate?: FieldValidator;

  /**
   * Called to convert a JS value to a database-suitable form.
   */
  serialize?: FieldSerializer;

  /**
   * Called to convert database value to a JS value
   */
  deserialize?: FieldDeserializer;

  /**
   * One of predefined types.
   * As sqlite does not use real strict typing, it is just a hint, and the field still can hold a value of any type.
   */
  typeHint?: TypeHint;

  /**
   * Whether null is accepted as a value for the field.
   * It is mapped to `NOT NULL` constraint in sql schema.
   * Note that is `allowNull` is true and value you are going to write into database is null, no validator is called.
   * By default, allow null is true.
   */
  allowNull?: boolean;

  /**
   * Default value for the field.
   * It is mapped to sql `DEFAULT` constraint and is not used by Model.build, so do not expect the instance created with Model.build to have this value for omitted fields.
   * Use newGenerate for such behaviour.
   */
  defaultValue?: string|number;

  /**
   * Routine for generating a default value for omitted properties when building new instances.
   * When creating a new instance with Model.build function, this function is called for each field.
   * This function is called before `validate` and `serialize`.
   * @param given The value for this field as given to Model.build
   * @returns {any} The generated value for the field.
   */
  newGenerate?: (given: any) => any;

  /**
   * Whether the field should be unique.
   * To make compound unique constraints, use Model.addUniqueConstraint.
   */
  unique?: boolean;

  /**
   * Whether the field is a primary key.
   * If more than one field of the model have this flag set, the primary key is going to be a compound one.
   */
  primaryKey?: boolean;

  /**
   * Collation to be used for text values.
   */
  collation?: string;
}

/**
 * Type hints for field specifications.
 */
export enum TypeHint {
  Text = 'TEXT',
  Integer = 'INTEGER',
  Real = 'REAL',
  Blob = 'BLOB',
  Boolean = 'BOOLEAN',
  Date = 'DATE'
}

export type FieldValidator = (value: any) => boolean;
export type FieldSerializer = (value: any) => any;
export type FieldDeserializer = (value: any) => any;

export const CollationNoCase = 'NOCASE';

/**
 * Handy helper that wraps field specifications and provides extra functions.
 */
export class FieldSpecWrapper {
  constructor(public fieldName: string, public fieldSpec: FieldSpec) {

  }

  convertToDatabaseForm(value: any): any {
    let fieldSpec = this.fieldSpec;

    if (fieldSpec.allowNull !== false && value == null) {
      return null;
    }

    if (fieldSpec.validate != null) {
      if (!fieldSpec.validate(value)) {
        throw new Error(`Invalid value for a property value ${this.fieldName}`);
      }
    }

    return fieldSpec.serialize == null ? value : fieldSpec.serialize(value);
  }

  convertFromDatabaseForm(value: any): any {
    return this.fieldSpec.deserialize ? this.fieldSpec.deserialize(value) : value;
  }
}

/**
 * Predefined validators that can be used with FieldSpec.validate parameter.
 */
export namespace FieldValidators {
  function ofClass(value: any, className: string): boolean {
    return Object.prototype.toString.call(value) === '[object ' + className + ']';
  }

  export const String = (value: any): boolean => typeof value == 'string' || ofClass(value, 'String');
  export const Number = (value: any): boolean => typeof value == 'number' || ofClass(value, 'Number');
  export const Boolean = (value: any): boolean => typeof value == 'boolean' || ofClass(value, 'Boolean');
  export const Date = (value: any): boolean => ofClass(value, 'Date');
  export const Empty = (value: any): boolean => value === null || value === undefined;
  export const None = () => false;
  export const Any = () => true;

  export function OneOf(...validators: FieldValidator[]): FieldValidator {
    return function(value: any): boolean {
      return validators.some(validator => validator(value));
    }
  }

  export function Both(...validators: FieldValidator[]): FieldValidator {
    return function(value: any): boolean {
      return validators.every(validator => validator(value));
    }
  }

  export function OfClass(className: string): FieldValidator {
    return function(value: any): boolean {
      return ofClass(value, className);
    }
  }
}

export interface ModelOptions {
  /**
   * If the value is true, each instance is going to have extra 'createdAt' field storing timestamp for inserting the instance into a database.
   */
  createTimestamp?: boolean;

  /**
   * If the value is true, each instance is going to have extra 'updatedAt' field storing timestamp for the last time the instance was modified.
   */
  updateTimestamp?: boolean;

  defaultSorting?: string|SortProp|null;
}

export enum SortOrder {
  Asc,
  Desc
}

export interface SortProp {
  by: string;
  order?: SortOrder;
  caseSensitive?: boolean;
}

export type WhereCriterion = { [name: string]: any };

export interface QueryOptions {
  /**
   * Search criteria
   */
  where?: WhereCriterion
}

export enum JoinType {
  Inner = 'INNER',
  Left = 'LEFT'
}

export interface JoinOption {
  relation: Relation;
  type: JoinType;
}

/**
 * Search criteria and options
 */
export interface FindOptions extends QueryOptions {
  limit?: number;
  offset?: number;

  /**
   * Whether we should get a total count of results (count of results without LIMIT).
   */
  fetchTotalCount?: boolean;

  /**
   * Sorting options.
   */
  sort?: (SortProp|string)[];

  join?: JoinOption[];
}

export interface UpdateOptions extends QueryOptions {
  set: {
    [name: string]: any
  }
}

export interface RemoveOptions extends QueryOptions {

}

export type JoinedInstances<T> = { [name: string]: Instance<T>[] };

export interface FindResult<T> {
  totalCount?: number|null;
  items: Instance<T>[];
  joined?: JoinedInstances<any>;
}

export interface FindRelationResult<T, R> extends FindResult<T> {
  relationItems: Instance<R>[];
}

export type SqlBindings = { [name: string]: any };

export class SqlBoundParams {
  static uniqueName(): string {
    return 'uniq_' + Math.floor(Math.random() * 100000);
  }

  bind(value: any): string {
    let bindingName = SqlBoundParams.uniqueName();
    this._bound[bindingName] = value;
    return ':' + bindingName;
  }

  merge(another: SqlBoundParams): void {
    Object.assign(this._bound, another._bound);
  }

  get count(): number { return Object.keys(this._bound).length; }

  get sqlBindings(): SqlBindings { return this._bound; }

  /** Protected area **/

  protected _bound: SqlBindings = {};
}

class ParsedJoin {
  public joinType: JoinType;
  public sourceTable: string;
  public selectWhere?: string;
  public alias: string;
  public condition: string;

  make(): string {
    let alias = this.alias ? 'AS ' + this.alias : '';
    let source: string;
    if (this.selectWhere == null) {
      source = this.sourceTable;
    } else {
      source = `SELECT * FROM ${this.sourceTable} WHERE ${this.selectWhere}`;
    }
    return `${this.joinType} JOIN ${source} ${alias} ON ${this.condition}`;
  }
}

const CHAR_UNDERSCORE = '_'.charCodeAt(0);
function isValidName(name: string): boolean {
  if (name.length === 0 || !isAlphaCode(name.charCodeAt(0))) {
    return false;
  }
  for (let j = 1; j < name.length; ++j) {
    let ch = name.charCodeAt(j);
    if (!(isAlphaCode(ch) || isDigitCode(ch) || ch === CHAR_UNDERSCORE)) {
      return false;
    }
  }
  return true;
}

/**
 * Base ORM class.
 */
export class Database {
  /**
   * Defines a new model.
   * @param {string} modelName Name for the model
   * @param {{[p: string]: FieldSpec}} modelSpec Model specification
   * @param {ModelOptions} modelOptions Model options
   * @returns {Model<T>} Newly created model
   */
  define<T>(modelName: string, modelSpec: { [name: string]: FieldSpec }, modelOptions?: ModelOptions): Model<T> {
    if (!isValidName(modelName)) {
      throw new Error(`Cannot define model: [${modelName}] is invalid name for a model`);
    }
    if (this.getModel(modelName)) {
      throw new Error(`Cannot define model: [${modelName}] already defined`);
    }
    let model = new Model<T>(this, modelName, modelSpec, modelOptions);
    this._models.push(model);
    return model;
  }

  /**
   * Get model with given name.
   * @param {string} modelName Model name
   * @returns {Model<T>|null} Model object or null if no model with given name defined.
   */
  getModel<T>(modelName: string): Model<T>|null {
    let foundModel = this._models.find(model => model.name === modelName);
    return foundModel == null ? null : foundModel;
  }

  /**
   * Creates sql schema for all defined models.
   * @returns {string} SQL schema
   */
  createSchema(): string {
    let schemaTables: string[] = [];

    for (let model of this._models) {
      let columns: string[] = [];
      let primaryKeyCount = 0;
      for (let fieldName of Object.keys(model.spec)) {
        let specWrapper = model.spec[fieldName];

        let parts: string[] = [];
        parts.push(fieldName);
        if (specWrapper.fieldSpec.typeHint != null) {
          parts.push(specWrapper.fieldSpec.typeHint);
        }
        if (specWrapper.fieldSpec.primaryKey === true) {
          parts.push('PRIMARY KEY');
          ++primaryKeyCount;
          if (primaryKeyCount > 1) {
            // compound primary keys are not supported
            throw new Error('Cannot create database schema: multiple primary keys are defined for model ' + model.name);
          }
        }
        if (specWrapper.fieldSpec.unique === true) {
          parts.push('UNIQUE');
        }
        if (specWrapper.fieldSpec.collation != null) {
          parts.push('COLLATE');
          parts.push(specWrapper.fieldSpec.collation);
        }
        if (specWrapper.fieldSpec.allowNull === false) {
          parts.push('NOT NULL');
        }
        if (specWrapper.fieldSpec.defaultValue != null) {
          parts.push('DEFAULT');
          let defValue = specWrapper.convertToDatabaseForm(specWrapper.fieldSpec.defaultValue);
          if (typeof defValue === 'string') {
            parts.push('"' + defValue + '"');
          } else {
            parts.push(defValue);
          }
        }

        columns.push(parts.join(' '));
      }

      columns.push(...model.constraints);
      schemaTables.push(`CREATE TABLE ${model.name}(${columns.join(', ')})`);
    }

    return schemaTables.join('; ');
  }

  /**
   * Writes schema to the underlying database
   * @returns {Promise<void>}
   */
  async flushSchema(): Promise<void> {
    if (this._schemaFlushed) {
      throw new Error('Database schema has already been flushed');
    }
    let schema = this.createSchema();
    if (!this._connection) {
      throw new Error("Cannot flush schema: no database connection");
    }
    await this._connection.exec(schema);
    this._schemaFlushed = true;
  }

  /**
   * Writes an database instance to the database.
   * @param {DatabaseInstance<any>} inst The instance
   * @returns {Promise<void>}
   */
  async createInstance<T>(inst: DatabaseInstance<any>): Promise<void> {
    let columns = [...inst.$fields.keys()];
    let values = columns.map(key => {
      let fieldWrapper = inst.$model.getFieldWrapper(key);
      if (!fieldWrapper) {
        throw new Error('Cannot find field data for property ' + key);
      }
      return fieldWrapper.convertToDatabaseForm(inst.$fields.get(key));
    });

    let valuesPlaceholders = new Array(values.length).fill('?').join(', ');

    let sql = `INSERT INTO ${inst.$model.name} (${columns.join(', ')}) VALUES (${valuesPlaceholders})`;
    let runResult = await this._run(sql, values);

    // if we have a field for a primary key, but it is not specified explicitly, we should set it now
    let pkName = inst.$model.getPrimaryKeyName();
    if (inst.$fields.has(pkName)) {
      inst.$fields.set(pkName, runResult.lastInsertROWID);
    }

    inst.$rowId = runResult.lastInsertROWID;
  }

  async updateInstance(inst: DatabaseInstance<any>, updateFields?: string[]): Promise<void> {
    if (!inst.$created) {
      throw new Error('Cannot update an instance that has not been created yet!');
    }

    let columns = updateFields == null ? [...inst.$fields.keys()] : updateFields;
    let values = columns.map(key => {
      let fieldWrapper = inst.$model.getFieldWrapper(key);
      if (!fieldWrapper) {
        throw new Error('Cannot find field data for property ' + key);
      }
      return fieldWrapper.convertToDatabaseForm(inst.$fields.get(key));
    });

    let placeholders = columns.map(column => {
      return column + ' = ?'
    });

    let pk = inst.$model.getPrimaryKeyName();
    values.push(inst.$rowId);

    let sql = `UPDATE ${inst.$model.name} SET ${placeholders} WHERE ${pk} = ?`;
    await this._run(sql, values);
  }

  async removeInstance(inst: DatabaseInstance<any>): Promise<void> {
    if (!inst.$created) {
      throw new Error('Cannot remove an instance that has not been created yet!');
    }

    let pk = inst.$model.getPrimaryKeyName();

    let sql = `DELETE FROM ${inst.$model.name} WHERE ${pk} = ?`;
    let values = [inst.$rowId];

    await this._run(sql, values);
  }

  async find<T>(model: Model<T>, options: FindOptions): Promise<FindResult<T>> {
    let query = SelectQueryBuilder.buildSelect(model, options);

    let sqlResults = await this._all(query.selectQuery, query.bound);

    let result: FindResult<T> = {
      totalCount: null,
      items: []
    };
    for (let sqlResult of sqlResults) {
      result.items.push(model.buildFromDatabaseResult(sqlResult, model.name));
    }

    // create instances for requested joins
    if (options.join && options.join.length > 0) {
      result.joined = {};
      for (let joinOption of options.join) {
        let items: Instance<any>[] = (result.joined[joinOption.relation.name] = []);
        for (let sqlResult of sqlResults) {
          let joinedModel = joinOption.relation.relationData.companionModel;
          items.push(joinedModel.buildFromDatabaseResult(sqlResult, joinOption.relation.name));
        }
      }
    }

    if (options.fetchTotalCount === true && query.countQuery) {
      let countResult = await this._get(query.countQuery, query.bound);
      result.totalCount = countResult['COUNT(*)'] as number;
    }

    return result;
  }

  async update<T>(model: Model<T>, options: UpdateOptions): Promise<void> {
    let query = QueryBuilder.buildUpdate(model, options);
    if (!query.query) {
      return;
    }
    await this._run(query.query, query.bound);
  }

  async remove<T>(model: Model<T>, options: RemoveOptions): Promise<void> {
    let query = QueryBuilder.buildRemove(model, options);
    if (!query.query) {
      return;
    }
    await this._run(query.query, query.bound);
  }

  async removeAll<T>(model: Model<T>): Promise<void> {
    let sql = `DELETE FROM ${model.name}`;
    await this._run(sql);
  }

  async count(model: Model<any>): Promise<number> {
    let sql = `SELECT COUNT(*) FROM ${model.name}`;
    return (await this._get(sql))['COUNT(*)'] as number;
  }

  /**
   * Returns active connection to database
   * @return {AbstractConnection | null}
   */
  get connection(): AbstractConnection|null {
    return this._connection;
  }

  /**
   * Sets connection to database.
   * You should manually initialize connection and call its `connect` method before or after passing to this method.
   * After connection has been set, its ownership is given to this database, and it can disconnect from at in any time.
   * @param {AbstractConnection | null} conn Database connection
   * @return {Promise<void>} Resolved when old connection closed and new is set
   */
  async setConnection(conn: AbstractConnection|null): Promise<void> {
    if (this._connection) {
      await this._connection.disconnect();
    }

    this._connection = conn;
  }

  static async fromConnection(connection: AbstractConnection): Promise<Database> {
    const db = new Database();
    await db.setConnection(connection);
    return db;
  }

  /** Protected area **/

  protected _connection: AbstractConnection|null = null;
  protected _models: Model<any>[] = [];
  protected _schemaFlushed: boolean = false;

  protected async _prepare(sql: string, bindings?: SqlBoundParams|any[]): Promise<IStatement> {
    if (!this._connection) {
      throw new Error("Cannot prepare sql statement: no database connection set");
    }

    return this._connection.prepare(sql, bindings);
  }

  protected async _run(sql: string, bindings?: SqlBoundParams|any[]): Promise<IRunResult> {
    return (await this._prepare(sql, bindings)).run();
  }

  protected async _get(sql: string, bindings?: SqlBoundParams|any[]): Promise<any> {
    return (await this._prepare(sql, bindings)).get();
  }

  protected async _all(sql: string, bindings?: SqlBoundParams|any[]): Promise<any[]> {
    return (await this._prepare(sql, bindings)).all();
  }
}

interface BuiltSelectQuery {
  selectQuery: string;
  bound: SqlBoundParams;
  countQuery?: string;
}

interface BuiltQuery {
  query: string;
  bound: SqlBoundParams;
}

enum WhereTreeContext {
  Logical,
  Value
}

enum WhereTreeOperator {
  And = ' AND ',
  Or = ' OR '
}

class WhereTree {
  constructor(context: WhereTreeContext, operator: WhereTreeOperator = WhereTreeOperator.And,
              closestField: string = '') {
    this._context = context;
    this._operator = operator;
    this._closestField = closestField;
  }

  append(child: string|WhereTree): void {
    if (this._children == null) {
      this._children = [ child ];
    } else {
      this._children.push(child);
    }
  }

  build(): string {
    if (this._children == null || this._children.length === 0) {
      return '';
    } else if (this._children.length === 1) {
      let child = this._children[0];
      return typeof child === 'string' ? child : child.build();
    } else {
      return this._children.map(x => '(' + (typeof x === 'string' ? x : x.build()) + ')').join(this._operator);
    }
  }

  get children(): (string|WhereTree)[] { return this._children == null ? [] : this._children; }
  get context(): WhereTreeContext { return this._context; }
  get closestField(): string { return this._closestField; }

  /** Protected area **/

  protected _children: null|(string|WhereTree)[] = [];
  protected _context: WhereTreeContext;
  protected _operator: WhereTreeOperator;
  protected _closestField: string;
}

abstract class QueryBuilder {
  static buildUpdate(model: Model<any>, options: UpdateOptions): BuiltQuery {
    return new UpdateQueryBuilder(model, options)._buildUpdate();
  }

  static buildRemove(model: Model<any>, options: RemoveOptions): BuiltQuery {
    return new RemoveQueryBuilder(model, options)._buildRemove();
  }

  static buildSelect(model: Model<any>, options: FindOptions): BuiltSelectQuery {
    return new SelectQueryBuilder(model, options)._buildSelect();
  }

  /** Protected area **/

  protected _model: Model<any>;
  protected _whereClause: WhereCriterion;
  protected _globalWhere: WhereTree = new WhereTree(WhereTreeContext.Logical);
  protected _constraints: string[]|null = null;
  protected _joins: ParsedJoin[]|null = null;
  protected _extraColumns: string[]|null = null;
  protected _bound: SqlBoundParams = new SqlBoundParams();

  protected static _mappedOperators = mapFromObject<string>({
    ['$eq']: '=',
    ['$like']: 'LIKE',
    ['$gt']: '>',
    ['$lt']: '<',
    ['$gte']: '>=',
    ['$lte']: '<=',
    ['$ne']: '<>',
    ['$glob']: 'GLOB'
  });

  protected constructor(model: Model<any>, whereClause?: WhereCriterion) {
    this._model = model;
    this._whereClause = whereClause == null ? { } : whereClause;
  }

  protected _buildWhere(): void {
    Object.keys(this._whereClause).forEach(
        key => this._buildWhereNode(key, this._whereClause[key], this._globalWhere)
    );
  }

  protected static _expectPlain(value: any): void {
    let type = typeof value;
    if (['string', 'number', 'boolean'].indexOf(type) < 0 && value != null) {
      throw new Error('Plain value expected, but got this: ' + value + ' of type ' + type);
    }
  }

  protected _buildWhereNode(key: string, value: any, parentNode: WhereTree): void {
    /**
     * let where = {
          field: { // << WhereTreeContext.Logical
            $eq: 'some' // << WhereTreeContext.Value
          },
          $and: { // << WhereTreeContext.Logical
            field1: { // << WhereTreeContext.Logical
              $eq: 'value' // << WhereTreeContext.Value
            }
          }
        };
     */

    if (key.startsWith('$')) {
      // special key: operator
      key = key.toLowerCase();
      if (parentNode.context === WhereTreeContext.Logical) {
        if (key === '$and' || key === '$or') {
          // join sub-trees with logical operator.
          // logical operators are the only operators that can appear at top level, not under any field name
          let operator = key === '$and' ? WhereTreeOperator.And : WhereTreeOperator.Or;
          let node = new WhereTree(WhereTreeContext.Logical, operator);

          for (let subKey of Object.keys(value)) {
            this._buildWhereNode(subKey, value[subKey], node);
          }

          parentNode.append(node);
        } else {
          throw new Error(`Unexpected operator [${key}], unknown or not allowed here`);
        }
      } else if (parentNode.context === WhereTreeContext.Value) {
        this._buildOperator(key.toLowerCase(), parentNode.closestField, value, parentNode);
      }
    } else {
      if (parentNode.context === WhereTreeContext.Logical) {
        // key is name of some field
        if (typeof value === 'object' && value != null) {
          // any object given as a value for a field name it treated as a container for operators.
          // so if your fields can convert an object to plain database value and you want to search for objects,
          // the following will not work:
          // field_name: { prop: ... }
          // use explicit $eq operator instead:
          // field_name: { $eq: { prop: ... } }

          let node = new WhereTree(WhereTreeContext.Value, WhereTreeOperator.And, key);
          for (let subKey of Object.keys(value)) {
            this._buildWhereNode(subKey, value[subKey], node);
          }
          parentNode.append(node);
        } else {
          // if just a plain value given, we assume that we should use equality operator
          this._buildMappedOperator('=', key, value, parentNode);
        }
      } else if (parentNode.context === WhereTreeContext.Value) {
        throw new Error(`Unexpected value under a field name (${value}): an operator expected`);
      }
    }
  }

  protected _buildMappedOperator(operator: string, left: string, right: any, parentNode: WhereTree): void {
    let fieldData = this._attachColumn(left);
    let rightConv = fieldData.fsw.convertToDatabaseForm(right);
    parentNode.append(fieldData.column + ' ' + operator + ' ' + this._bound.bind(rightConv));
  }

  protected _buildOperator(operator: string, left: string, right: any, parentNode: WhereTree): void {
    if (QueryBuilder._mappedOperators.has(operator)) {
      this._buildMappedOperator(QueryBuilder._mappedOperators.get(operator) as string, left, right, parentNode);
    } else if (operator === '$in' || operator === '$notin') {
      // for these operators we expect a list of values
      if (!right.length) {
        throw new Error('$in and $notin operators expect a list of values');
      } else if (right.length === 1) {
        // no need for IN operator if we have only one value, replace it with an equality operator
        this._buildMappedOperator(
            QueryBuilder._mappedOperators.get(operator === '$in' ? '$eq' : '$ne') as string,
            left, right[0], parentNode
        );
      } else {
        // translate to IN or NOT IN sql operators
        let fieldData = this._attachColumn(left);
        let list = (right as any[]).map(
            x => this._bound.bind(fieldData.fsw.convertToDatabaseForm(x))
        );
        let mapped = operator === '$in' ? 'IN' : 'NOT IN';
        parentNode.append(fieldData.column + ' ' + mapped + ' (' + list.join(', ') + ')');
      }
    } else {
      throw new Error(`Invalid operator [${operator}]`);
    }
  }

  protected static _makeColumnListForModel(model: Model<any>, prefix?: string): string[] {
    let columns: string[] = model.fields.map(fsw => {
      if (prefix) {
        let colName = prefix + '.' + fsw.fieldName;
        return `${colName} AS "${colName}"`;
      } else {
        return fsw.fieldName;
      }
    });

    if (model.fields.find(x => x.fieldSpec.primaryKey === true) == null) {
      let colName = model.name + '.' + ROWID;
      columns.push(`${colName} AS "${colName}"`);
    }

    return columns;
  }

  protected static _makeSort(by: string, order?: SortOrder, caseSensitive?: boolean): string {
    let collation = caseSensitive ? '' : 'COLLATE NOCASE';
    let sortOrder = order === SortOrder.Desc ? 'DESC' : 'ASC';
    return `${by} ${collation} ${sortOrder}`;
  }

  protected _makeWhere(): string {
    let whereClause = this._globalWhere.build();
    return whereClause ? 'WHERE ' + whereClause : '';
  }

  protected _attachColumn(fieldName: string): { fsw: FieldSpecWrapper, column: string } {
    let sindex = fieldName.indexOf('$');
    if (sindex < 0) {
      return {
        fsw: this._model.getFieldWrapperChecked(fieldName),
        column: this._model.name + '.' + fieldName
      };
    } else if (sindex === 0) {
      throw new Error('Invalid value for a field name:' + fieldName);
    } else {
      let relationName = fieldName.slice(0, sindex);
      let relatedFieldName = fieldName.slice(sindex + 1);
      if (!relationName || !relatedFieldName) {
        throw new Error('Invalid value for a field name: ' + fieldName);
      }

      let relation = this._model.getRelationFieldData(relationName);
      if (!relation) {
        throw new Error(`Invalid value for a foreign field name: ${fieldName}. no relation found`);
      }

      let relatedModel = relation.companionModel;

      let field = relation.companionModel.getFieldWrapper(relatedFieldName);
      if (!field) {
        // if we have no field on the companion model itself, we should check if the relation uses a relation model
        // and the relation model has a field with the given name
        if (relation.type === RelationType.ManyToMany) {
          field = (relation as MultiRelationFieldData).relationModel.getFieldWrapper(relatedFieldName);
          relatedModel = (relation as MultiRelationFieldData).relationModel;
          if (!field) {
            throw new Error(`Invalid value for a foreign field name: ${fieldName}. No relation field found`);
          }
        } else {
          throw new Error(`Invalid value for a foreign field name: ${fieldName}. No relation field found`);
        }
      }

      let table = '__sa_' + relatedModel.name;

      // add join to the query
      // if we already joined this table, we can use it again
      if (!this._joins || !this._joins.some(x => x.alias === table)) {
        let join = new ParsedJoin();
        join.joinType = JoinType.Left;
        join.sourceTable = relatedModel.name;
        join.condition = relation.getJoinCondition(this._model, table, relatedModel);
        join.alias = table;

        this._addJoin(join);

        // if joining another table will produce more then one result, we should group rows by the current model id,
        // to avoid fetching duplicates
        if (relation.resultsInMany) {
          // check if we have already added GROUP BY constraint
          if (!this._constraints || !this._constraints.some(x => x.toUpperCase().startsWith('GROUP BY'))) {
            this._addConstraint('GROUP BY ' + this._model.name + '.' + this._model.getPrimaryKeyName());
          }
        }
      }

      return {
        fsw: field,
        column: table + '.' + relatedFieldName
      };
    }
  }

  protected _addJoin(jd: ParsedJoin): void {
    if (this._joins == null) {
      this._joins = [ jd ];
    } else {
      this._joins.push(jd);
    }
  }

  protected _addConstraint(constr: string): void {
    if (this._constraints == null) {
      this._constraints = [ constr ];
    } else {
      this._constraints.push(constr);
    }
  }
}

class UpdateQueryBuilder extends QueryBuilder {
  constructor(model: Model<any>, options: UpdateOptions) {
    super(model, options.where);
    this._options = options;
  }

  _buildUpdate(): BuiltQuery {
    this._buildWhere();

    let columns = Object.keys(this._options.set);
    if (columns.length === 0) {
      // nothing to update
      return {
        query: '',
        bound: this._bound
      };
    }

    let setClause: string = columns.map(
        col => col + ' = ' + this._bound.bind(this._model.getFieldWrapperChecked(col).convertToDatabaseForm(this._options.set[col]))
    ).join(', ');

    let query: string;
    let whereClause = this._makeWhere();

    if (this._joins || this._constraints) {
      let joins = this._joins == null ? '' : this._joins.map(x => x.make()).join(' ');
      let pk = this._model.getPrimaryKeyName();
      query = `UPDATE ${this._model.name} SET ${setClause} WHERE ${pk} IN (SELECT ${this._model.name}.${pk} FROM ${this._model.name} ${joins} ${whereClause})`;
    } else {
      query = `UPDATE ${this._model.name} SET ${setClause} ${whereClause}`;
    }

    return {
      query,
      bound: this._bound
    };
  }

  /** Protected area **/

  protected _options: UpdateOptions;
}

class RemoveQueryBuilder extends QueryBuilder {
  constructor(model: Model<any>, options: RemoveOptions) {
    super(model, options.where);
    this._options = options;
  }

  _buildRemove(): BuiltQuery {
    if (!this._whereClause || this._whereClause.length === 0) {
      throw new Error('Attempted to call Model.remove without search criteria. To remove all instances, use Model.removeAll');
    }

    this._buildWhere();

    let query: string;

    let whereClause = this._makeWhere();
    if (this._joins || this._constraints) {
      let joins = this._joins == null ? '' : this._joins.map(x => x.make()).join(' ');
      let pk = this._model.getPrimaryKeyName();
      query = `DELETE FROM ${this._model.name} WHERE ${pk} IN (SELECT ${this._model.name}.${pk} FROM ${this._model.name} ${joins} ${whereClause})`;
    } else {
      query = `DELETE FROM ${this._model.name} ${whereClause}`;
    }

    return {
      query,
      bound: this._bound
    };
  }

  /** Protected area **/

  protected _options: RemoveOptions;
}

class SelectQueryBuilder extends QueryBuilder {
  constructor(model: Model<any>, options: FindOptions) {
    super(model, options.where);
    this._options = options;
  }

  _buildSelect(): BuiltSelectQuery {
    this._buildWhere();
    this._buildConstraints();
    this._buildSort();
    this._buildJoins();

    // build list of columns we should fetch from database
    let columns: string[] = QueryBuilder._makeColumnListForModel(this._model, this._model.name);
    if (this._extraColumns != null) {
      columns.push(...this._extraColumns);
    }

    let whereClause: string = this._makeWhere();
    let joins = this._joins == null ? '' : this._joins.map(x => x.make()).join(' ');
    let constraints = this._constraints == null ? '' : this._constraints.join(' ');
    let selectQuery = `SELECT ${columns.join(', ')} FROM ${this._model.name} ${joins} ${whereClause} ${constraints}`;

    if (this._options.fetchTotalCount) {
      let countConstraints: string = '';
      if (this._constraints != null) {
        countConstraints = this._constraints.filter(constr => !constr.startsWith('LIMIT')).join(' ');
      }
      let joins = this._joins == null ? '' : this._joins.map(x => x.make()).join(' ');
      let countQuery = `SELECT COUNT(*) FROM ${this._model.name} ${joins} ${whereClause} ${countConstraints}`;

      return {
        selectQuery,
        bound: this._bound,
        countQuery
      };
    }

    return {
      selectQuery,
      bound: this._bound
    };
  }

  /** Protected area **/

  protected _options: FindOptions;

  protected _buildSort(): void {
    let sortParts: string[] = [];
    let defSorting = this._model.defaultSorting;
    if (this._options.sort != null && this._options.sort.length > 0) {
      // apply specified sorting rules
      for (let sortProp of this._options.sort) {
        if (typeof sortProp === 'string') {
          if (this._model.getFieldSpec(sortProp) == null) {
            throw new Error(`Invalid sorting property: no field [${sortProp}]`);
          }
          sortParts.push(QueryBuilder._makeSort(sortProp, SortOrder.Asc, false));
        } else {
          if (this._model.getFieldSpec(sortProp.by) == null) {
            throw new Error(`Invalid sorting property: no field [${sortProp}]`);
          }
          sortParts.push(QueryBuilder._makeSort(sortProp.by, sortProp.order, sortProp.caseSensitive));
        }
      }

      if (defSorting != null) {
        // check if default sorting option was already used
        if (!this._options.sort.some(x => {
          return (typeof x === 'string' && x === (defSorting as SortProp).by) ||
              (typeof x !== 'string' && x.by === (defSorting as SortProp).by);
        })) {
          // if default sorting option was not used, add it to the end
          if (this._model.getFieldSpec(defSorting.by) == null) {
            throw new Error(`Invalid sorting property: no field [${defSorting.by}]`);
          }
          sortParts.push(QueryBuilder._makeSort(defSorting.by, defSorting.order, defSorting.caseSensitive));
        }
      }
    }

    if (sortParts.length === 0 && defSorting != null) {
      sortParts.push(QueryBuilder._makeSort(defSorting.by, defSorting.order, defSorting.caseSensitive));
    }

    if (sortParts.length > 0) {
      this._addConstraint('ORDER BY ' + sortParts.join(', '));
    }
  }

  protected _buildJoins(): void {
    if (this._options.join && this._options.join.length > 0) {
      for (let joinOption of this._options.join) {
        // generate and join sql for joining a table
        let rd = joinOption.relation.relationData;

        let jd = new ParsedJoin();
        jd.alias = rd.name;
        jd.joinType = joinOption.type;
        jd.sourceTable = rd.companionModel.name;
        jd.condition = rd.getJoinCondition(this._model, rd.name, rd.companionModel);

        this._addJoin(jd);

        // and we should add extra columns to select joined items as well.
        this._addExtraColumns(...QueryBuilder._makeColumnListForModel(rd.companionModel, rd.name));
      }
    }
  }

  protected _buildConstraints(): void {
    if (this._options.limit != null) {
      this._addConstraint('LIMIT ' + this._options.limit);
    }
    if (this._options.offset != null) {
      this._addConstraint('OFFSET ' + this._options.offset);
    }
  }

  protected _addExtraColumns(...col: string[]): void {
    if (this._extraColumns == null) {
      this._extraColumns = [ ...col ];
    } else {
      this._extraColumns.push(...col);
    }
  }
}
