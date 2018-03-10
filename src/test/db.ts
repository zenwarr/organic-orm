import { should, expect } from 'chai';
import {
  CollationNoCase, Database, Model, MultiRelation, SingleRelation, SortOrder,
  TypeHint
} from "../index";
import uuid = require("uuid");
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

should();
chai.use(chaiAsPromised);

describe('Database', function() {
  describe('createSchema', function() {
    let db: Database;

    beforeEach(async function() {
      db = await Database.open(':memory:');
    });

    it("should create a simple schema", function () {
      db.define('foo', {
        id: { typeHint: TypeHint.Integer, primaryKey: true }
      });
      expect(db.createSchema()).to.be.equal('CREATE TABLE foo(id INTEGER PRIMARY KEY)');
    });

    it("should throw when model name is invalid", function () {
      expect(() => db.define('$foo', {})).to.throw();
    });

    it("should create a schema with two columns", function () {
      db.define('foo', {
        id: { typeHint: TypeHint.Integer, primaryKey: true },
        someColumn: { typeHint: TypeHint.Text, collation: CollationNoCase, defaultValue: '' }
      });
      expect(db.createSchema())
          .to.be.equal('CREATE TABLE foo(id INTEGER PRIMARY KEY, someColumn TEXT COLLATE NOCASE DEFAULT "")');
    });

    it("should add fields after define", function () {
      let fooModel = db.define('foo', {
        id: { typeHint: TypeHint.Integer, primaryKey: true }
      });
      fooModel.addField('someColumn', { typeHint: TypeHint.Text });
      expect(db.createSchema())
          .to.be.equal('CREATE TABLE foo(id INTEGER PRIMARY KEY, someColumn TEXT)');
    });

    it("should throw when field name is invalid", function () {
      let fooModel = db.define('foo', {
        id: { typeHint: TypeHint.Integer, primaryKey: true }
      });
      expect(() => fooModel.addField('_someColumn', { typeHint: TypeHint.Text })).to.throw();
    });

    it("should throw on adding field with already reserved name", function () {
      let fooModel = db.define('foo', {
        id: { typeHint: TypeHint.Integer, primaryKey: true }
      });
      fooModel.addField('someColumn', { typeHint: TypeHint.Text });
      expect(() => fooModel.addField('someColumn', { typeHint: TypeHint.Text })).to.throw();
    });

    it("should update fields", function () {
      let fooModel = db.define('foo', {
        id: { typeHint: TypeHint.Integer }
      });
      fooModel.updateField('id', { primaryKey: true });
      expect(db.createSchema()).to.be.equal('CREATE TABLE foo(id INTEGER PRIMARY KEY)');
    });

    it("should create one-to-one association", function () {
      let fooModel = db.define('foo', {
        id: { typeHint: TypeHint.Integer, primaryKey: true }
      });

      let barModel = db.define('bar', {
        barId: { typeHint: TypeHint.Integer }
      });
      barModel.oneToOne(fooModel, null, {
        foreignKey: 'fooId'
      });

      expect(db.createSchema()).to.be
          .equal('CREATE TABLE foo(id INTEGER PRIMARY KEY); CREATE TABLE bar(barId INTEGER, fooId INTEGER UNIQUE, FOREIGN KEY (fooId) REFERENCES foo(id) ON UPDATE CASCADE ON DELETE CASCADE)')
    });

    it("should automatically find a primary key to link to", function () {
      let fooModel = db.define('foo', {
        id: { typeHint: TypeHint.Integer, primaryKey: true }
      });

      let barModel = db.define('bar', {
        barId: { typeHint: TypeHint.Integer }
      });
      barModel.oneToOne(fooModel, null, {
        foreignKey: 'fooId'
      });

      expect(db.createSchema()).to.be
          .equal('CREATE TABLE foo(id INTEGER PRIMARY KEY); CREATE TABLE bar(barId INTEGER, fooId INTEGER UNIQUE, FOREIGN KEY (fooId) REFERENCES foo(id) ON UPDATE CASCADE ON DELETE CASCADE)');
    });

    it("should create one-to-many association", function () {
      let fooModel = db.define('foo', {
        fooId: { typeHint: TypeHint.Integer }
      });

      let barModel = db.define('bar', {
        barId: { typeHint: TypeHint.Integer, primaryKey: true }
      });
      barModel.oneToMany(fooModel, null, {
        foreignKey: 'barId'
      });

      expect(db.createSchema()).to.be
          .equal('CREATE TABLE foo(fooId INTEGER, barId INTEGER, FOREIGN KEY (barId) REFERENCES bar(barId) ON UPDATE CASCADE ON DELETE CASCADE); CREATE TABLE bar(barId INTEGER PRIMARY KEY)');
    });

    it("should create many-to-many association", function () {
      let fooModel = db.define('foo', {
        fooId: { typeHint: TypeHint.Integer, primaryKey: true }
      });

      let barModel = db.define('bar', {
        barId: { typeHint: TypeHint.Integer, primaryKey: true }
      });
      barModel.manyToMany(fooModel, null, {
        model: 'foobar',
        leftForeignKey: 'barId',
        rightForeignKey: 'fooId'
      });

      expect(db.createSchema()).to.be
          .equal('CREATE TABLE foo(fooId INTEGER PRIMARY KEY); CREATE TABLE bar(barId INTEGER PRIMARY KEY); CREATE TABLE foobar(barId INTEGER, fooId INTEGER, FOREIGN KEY (barId) REFERENCES bar(barId) ON UPDATE CASCADE ON DELETE CASCADE, FOREIGN KEY (fooId) REFERENCES foo(fooId) ON UPDATE CASCADE ON DELETE CASCADE, UNIQUE(barId, fooId))');
    });

    it("should add timestamps", function () {
      let fooModel = db.define('foo', { }, {
        createTimestamp: true,
        updateTimestamp: true
      });

      expect(db.createSchema()).to.be.equal('CREATE TABLE foo(createdAt DATE, updatedAt DATE)');
    });
  });

  describe("flushSchema", function () {
    it("should flush a simple schema without errors", async function () {
      let db = await Database.open(':memory:');
      db.define('foo', {
        name: { typeHint: TypeHint.Text },
        value: { typeHint: TypeHint.Text }
      });
      await db.flushSchema();
    });
  });

  describe("creating instances", function () {
    let db: Database;
    let fooModel: Model<any>;

    beforeEach(async function() {
      db = await Database.open(':memory:');
      fooModel = db.define('foo', {
        id: { typeHint: TypeHint.Integer, primaryKey: true },
        name: { typeHint: TypeHint.Text, unique: true, allowNull: false },
        value: { typeHint: TypeHint.Text }
      });
    });

    it("should create an instance", async function () {
      await db.flushSchema();

      let obj = fooModel.build({
        name: 'option name',
        value: 'option value'
      });
      expect(obj).to.have.property('name', 'option name');
      expect(obj).to.have.property('value', 'option value');
      expect(obj).to.have.property('id', null);
      expect(obj.$fields).to.have.property('size', 3);
      expect(obj.$db).to.be.equal(db);
      expect(obj.$model).to.be.equal(fooModel);
    });

    it("should flush new instance to the database", async function () {
      await db.flushSchema();

      let obj = fooModel.build({
        name: 'option name',
        value: 'option value'
      });
      await obj.$flush();

      expect(obj.$created).to.be.true;
    });

    it("should generate an uuid", async function () {
      const GENERATED_UUID = uuid.v4();

      fooModel.addField('uuid', {
        typeHint: TypeHint.Text,
        newGenerate: given => given == null ? GENERATED_UUID : given
      });

      await db.flushSchema();

      let obj = fooModel.build({
        name: '',
        value: ''
      });
      expect(obj).to.have.property('uuid', GENERATED_UUID);
      await obj.$flush();
    });
  });

  describe("primary key", function () {
    let db: Database;

    beforeEach(async function() {
      db = await Database.open(':memory:');
    });

    it("primary key should be accesible", async function () {
      interface T {
        myIdent: string,
        name: string,
        value: string
      }

      let tModel = db.define<T>('test', {
        myIdent: { typeHint: TypeHint.Text, primaryKey: true },
        name: {},
        value: {}
      });
      await db.flushSchema();

      let inst = tModel.build({});
      expect(inst.myIdent).to.be.null;
      expect(inst.$rowId).to.be.null;

      inst.myIdent = 'some ident';
      expect(inst.myIdent).to.be.equal('some ident');
      expect(inst.$rowId).to.be.equal('some ident');

      inst.name = 'some name';
      expect(inst.myIdent).to.be.equal('some ident');
      expect(inst.$rowId).to.be.equal('some ident');

      inst.$rowId = 'another ident';
      expect(inst.myIdent).to.be.equal('another ident');
      expect(inst.$rowId).to.be.equal('another ident');
    });
  });

  describe("updating instances", function () {
    let db: Database;
    let fooModel: Model<any>;

    beforeEach(async function() {
      db = await Database.open(':memory:');
      fooModel = db.define('foo', {
        name: { typeHint: TypeHint.Text, unique: true, allowNull: false },
        value: { typeHint: TypeHint.Text }
      });
    });

    it("should update instance without errors", async function () {
      await db.flushSchema();

      let inst1 = fooModel.build({
        name: 'some name',
        value: 'some value'
      });
      await inst1.$flush();

      inst1.$fields.set('name', 'another name');
      await inst1.$flush();
    });

    it("should remove instance without errors", async function () {
      await db.flushSchema();

      let inst = fooModel.build({
        name: 'some name',
        value: 'some value'
      });
      await inst.$flush();

      await inst.$remove();
    });
  });

  describe("searching", function () {
    let db: Database;
    let fooModel: Model<any>;

    beforeEach(async function() {
      db = await Database.open(':memory:');
      fooModel = db.define('foo', {
        name: { typeHint: TypeHint.Text, unique: true, allowNull: false },
        value: { typeHint: TypeHint.Text },
        num: { typeHint: TypeHint.Integer },
        quirky: { serialize: x => x.value, deserialize: x => { return { x } } }
      });
      await db.flushSchema();

      await fooModel.build({ name: 'name1', value: 'value1', num: 1 }).$flush();
      await fooModel.build({ name: 'name2', value: 'value2', num: 2 }).$flush();
      await fooModel.build({ name: 'name3', value: 'value3', num: 3, quirky: { value: 123 } }).$flush();
      await fooModel.build({ name: 'name4', value: 'value4', num: 4 }).$flush();
      await fooModel.build({ name: 'name5', value: 'value5', num: 5 }).$flush();
    });

    it("should find instances by a simple query", async function () {
      let result = await fooModel.find({
        where: {
          name: 'name1'
        }
      });

      expect(result.totalCount).to.be.equal(null);
      expect(result.items).to.have.lengthOf(1);
      expect(result.items[0]).to.have.property('name', 'name1');
      expect(result.items[0]).to.have.property('value', 'value1');
    });

    it("should find all instances", async function () {
      let result = await fooModel.find();

      expect(result.items).to.have.lengthOf(5);
    });

    it("should fetch total count with where clause", async function () {
      let result = await fooModel.find({
        where: {
          name: 'name1'
        },
        fetchTotalCount: true
      });

      expect(result.totalCount).to.be.equal(1);
    });

    it("should get total count from model", async function () {
      let count = await fooModel.count();
      expect(count).to.be.equal(5);
    });

    it("should find instances by two conditions", async function () {
      let result = await fooModel.find({
        where: {
          name: 'name1',
          value: 'value1'
        }
      });

      expect(result.items).to.have.lengthOf(1);
      expect(result.items[0]).to.have.property('name', 'name1');
      expect(result.items[0]).to.have.property('value', 'value1');
    });

    it("should search with LIKE operator", async function () {
      let res = await fooModel.find({
        where: {
          name: {
            $like: 'name_'
          }
        }
      });

      expect(res.items).to.have.lengthOf(5);
    });

    it("should search with other operators", async function () {
      let res = await fooModel.find({
        where: {
          num: {
            $gt: 3
          }
        }
      });

      expect(res.items).to.have.lengthOf(2);
    });

    it("should search with logical operators", async function () {
      let res = await fooModel.find({
        where: {
          $or: {
            name: 'name1',
            value: 'value2'
          }
        }
      });

      expect(res.items).to.have.lengthOf(2);
    });

    it("should search with IN operator", async function () {
      let res = await fooModel.find({
        where: {
          name: {
            $in: ['name1', 'name2', 'name3', 'name26']
          }
        }
      });

      expect(res.items).to.have.lengthOf(3);
    });

    it("should search with NOT IN operator", async function () {
      let res = await fooModel.find({
        where: {
          name: {
            $notIn: ['name1', 'name2']
          }
        }
      });

      expect(res.items).to.have.lengthOf(3);
    });

    it("should throw when unknown field is used", async function () {
      return fooModel.find({
        where: { wtf: 'value' }
      }).should.be.rejected;
    });

    it("should throw when non-value used with $in operator", async function () {
      return fooModel.find({
        where: {
          name: {
            $in: [
              123, 'some value', {}
            ]
          }
        }
      }).should.be.rejected;
    });

    it("search value should be converted to database form", async function () {
      let res = await fooModel.find({
        where: {
          quirky: {
            $eq: {
              value: 123
            }
          }
        }
      });

      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('name', 'name3');
    });
  });

  describe("sorting", function () {
    let db: Database;
    let fooModel: Model<any>;

    beforeEach(async function() {
      db = await Database.open(':memory:');
      fooModel = db.define('foo', {
        name: { typeHint: TypeHint.Text },
        value: { typeHint: TypeHint.Text },
        num: { typeHint: TypeHint.Integer }
      });
      await db.flushSchema();

      await fooModel.build({ name: 'name1', value: 'value5', num: 1 }).$flush();
      await fooModel.build({ name: 'name2', value: 'value4', num: 2 }).$flush();
      await fooModel.build({ name: 'name3', value: 'value8', num: 3 }).$flush();
      await fooModel.build({ name: 'name3', value: 'value3', num: 3 }).$flush();
      await fooModel.build({ name: 'name4', value: 'value2', num: 4 }).$flush();
      await fooModel.build({ name: 'name5', value: 'value1', num: 5 }).$flush();
    });

    it("should apply explicit sorting", async function () {
      let res = await fooModel.find({
        where: {
          name: 'name3'
        },
        sort: [
          { by: 'value', order: SortOrder.Asc }
        ]
      });

      expect(res.items).to.have.lengthOf(2);
      expect(res.items[0]).to.have.property('name', 'name3');
      expect(res.items[0]).to.have.property('value', 'value3');
      expect(res.items[1]).to.have.property('name', 'name3');
      expect(res.items[1]).to.have.property('value', 'value8');
    });

    it("should throw when unknown sorting property specified", async function () {
      return fooModel.find({
        sort: [
          { by: 'wtf' }
        ]
      }).should.be.rejected;
    });

    it("default sorting should be applied when no other soring options present", async function () {
      interface Bar {
        name: string,
        id: string,
        num: number
      }

      let db = await Database.open(':memory:');

      let barModel = db.define<Bar>('bar', {
        name: { },
        id: { },
        num: { }
      }, {
        defaultSorting: {
          by: 'num',
          order: SortOrder.Desc
        }
      });
      await db.flushSchema();

      await barModel.build({ name: '1', id: 'third', num: 10 }).$flush();
      await barModel.build({ name: '2', id: 'second', num: 20 }).$flush();
      await barModel.build({ name: '2', id: 'first', num: 30 }).$flush();

      let res = await barModel.find();
      expect(res.items).to.have.lengthOf(3);
      expect(res.items.map(item => item.id)).to.be.deep.equal(['first', 'second', 'third']);
    });

    it("default sorting should be applied to the end of sorting options", async function () {
      interface Bar {
        name: string,
        id: string,
        num: number
      }

      let db = await Database.open(':memory:');

      let barModel = db.define<Bar>('bar', {
        name: { },
        id: { },
        num: { }
      }, {
        defaultSorting: 'num'
      });
      await db.flushSchema();

      await barModel.build({ name: '1', id: 'first', num: 10 }).$flush();
      await barModel.build({ name: '2', id: 'third', num: 30 }).$flush();
      await barModel.build({ name: '2', id: 'second', num: 20 }).$flush();

      let res = await barModel.find({
        sort: [ 'name' ]
      });
      expect(res.items).to.have.lengthOf(3);
      expect(res.items.map(item => item.id)).to.be.deep.equal(['first', 'second', 'third']);
    });
  });

  describe("one-to-one relation", function () {
    interface Foo {
      id: number;
      title: string;
      bar: SingleRelation<Foo, Bar>;
    }

    interface Bar {
      id: number;
      name: string;
      foo: SingleRelation<Bar, Foo>;
    }

    let db: Database;
    let fooModel: Model<Foo>;
    let barModel: Model<Bar>;

    beforeEach(async function() {
      db = await Database.open(':memory:');

      fooModel = db.define<Foo>('foo', {
        id: { primaryKey: true },
        title: {}
      });

      barModel = db.define<Bar>('bar', {
        id: { primaryKey: true },
        name: {}
      });

      fooModel.oneToOne(barModel, 'bar', { companionField: 'foo' });

      await db.flushSchema();

      await fooModel.build({ id: 1, title: 'mist' }).$flush();
      await fooModel.build({ id: 2, title: 'mockingbird' }).$flush();
      await fooModel.build({ id: 3, title: 'crime' }).$flush();
      await fooModel.build({ id: 20, title: 'some item' }).$flush();

      await barModel.build({ id: 10, name: 'king' }).$flush();
      await barModel.build({ id: 20, name: 'lee '}).$flush();
      await barModel.build({ id: 30, name: 'dost' }).$flush();
      await barModel.build({ id: 40, name: 'person' }).$flush();
    });

    it("should create relation access objects", function () {
      expect(fooModel.build({})).to.have.property('bar');
      expect(barModel.build({})).to.have.property('foo');
    });

    it("should throw when linking an unflushed object", async function () {
      let foo1 = await fooModel.findByPKChecked(1);
      return foo1.bar.link(barModel.build({})).should.be.rejected;
    });

    it("should throw when linking an instance of incorrect model", async function () {
      let foo1 = await fooModel.findByPKChecked(1);
      let foo2 = await fooModel.findByPKChecked(20);
      await foo1.bar.link(foo2 as any).should.be.rejected;

      let foo1After = await fooModel.findByPKChecked(1);
      expect(await foo1After.bar.get()).to.be.null;
    });

    it("should get related object", async function () {
      expect(await (await fooModel.findByPKChecked(1)).bar.get()).to.be.null;
    });

    it("should link an object", async function () {
      let foo1 = await fooModel.findByPKChecked(1);
      let bar10 = await barModel.findByPKChecked(10);
      await foo1.bar.link(bar10);
      expect(await foo1.bar.get()).to.have.property('id', 10);
      expect(await (await barModel.findByPKChecked(10)).foo.get()).to.have.property('id', 1);
    });

    it("should unlink an object", async function () {
      let foo1 = await fooModel.findByPKChecked(1);
      let bar10 = await barModel.findByPKChecked(10);
      await foo1.bar.link(bar10);
      await foo1.bar.unlink();
      expect(await foo1.bar.get()).to.be.null;
      expect(await (await barModel.findByPKChecked(10)).foo.get()).to.be.null;
    });

    it("should link using companion access object", async function () {
      let foo1 = await fooModel.findByPKChecked(1);
      let bar10 = await barModel.findByPKChecked(10);
      await bar10.foo.link(foo1);
      expect(await (await fooModel.findByPKChecked(1)).bar.get()).to.have.property('id', 10);
      expect(await (await barModel.findByPKChecked(10)).foo.get()).to.have.property('id', 1);
    });

    it("should unlink using companion access object", async function () {
      let foo1 = await fooModel.findByPKChecked(1);
      let bar10 = await barModel.findByPKChecked(10);
      await foo1.bar.link(bar10);
      await bar10.foo.unlink();
      (await fooModel.findByPKChecked(1)).bar.get().should.eventually.be.null;
      (await barModel.findByPKChecked(10)).foo.get().should.eventually.be.null;
    });

    it("searching by a foreign key", async function () {
      await Promise.all([
        (await fooModel.findByPKChecked(1)).bar.linkByPK(10),
        (await fooModel.findByPKChecked(2)).bar.linkByPK(20),
        (await fooModel.findByPKChecked(3)).bar.linkByPK(30)
      ]);

      let res = await fooModel.find({
        where: {
          bar$name: 'dost'
        }
      });

      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('id', 3);
    });
  });

  describe("one-to-many relation", function () {
    interface Foo {
      id: number;
      title: string;
      bars: MultiRelation<Foo, Bar, void>;
    }

    interface Bar {
      id: number;
      tag: string;
      foo: SingleRelation<Bar, Foo>;
    }

    let db: Database;
    let fooModel: Model<Foo>;
    let barModel: Model<Bar>;

    beforeEach(async function() {
      db = await Database.open(':memory:', { shouldCreate: true });

      fooModel = db.define<Foo>('foo', {
        id: { primaryKey: true, typeHint: TypeHint.Integer },
        title: { typeHint: TypeHint.Text }
      });

      barModel = db.define<Bar>('bar', {
        id: { typeHint: TypeHint.Integer, primaryKey: true },
        tag: { typeHint: TypeHint.Text, collation: CollationNoCase }
      });

      fooModel.oneToMany(barModel, 'bars', { companionField: 'foo' });

      await db.flushSchema();

      await fooModel.build({ id: 1, title: 'mist' }).$flush();
      await fooModel.build({ id: 2, title: 'mockingbird' }).$flush();

      await barModel.build({ id: 10, tag: 'king' }).$flush();
      await barModel.build({ id: 20, tag: 'lee'}).$flush();
    });

    it("should create relation access objects", function () {
      expect(fooModel.build({})).to.have.property('bars');
      expect(barModel.build({})).to.have.property('foo');
    });

    it("should get empty list of related instances", async function () {
      let foo1 = await fooModel.findByPKChecked(1);
      expect((await foo1.bars.find()).items).to.have.lengthOf(0);
      let bar10 = await barModel.findByPKChecked(10);
      expect(await bar10.foo.get()).to.be.null;
    });

    it("should link an instance to another using companion field", async function () {
      let foo2 = await fooModel.findByPKChecked(2);
      let bar10 = await barModel.findByPKChecked(10);
      await foo2.bars.link(bar10);

      let foo2_ = await fooModel.findByPKChecked(2);
      let bar10_ = await barModel.findByPKChecked(10);
      let res = await foo2_.bars.find();
      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('id', 10);
      expect((await bar10_.foo.get())).to.have.property('id', 2);
    });

    it("should link multiple instances", async function () {
      let foo2 = await fooModel.findByPKChecked(2);
      let bar10 = await barModel.findByPKChecked(10);
      let bar20 = await barModel.findByPKChecked(20);
      await foo2.bars.link(bar10);
      await foo2.bars.link(bar20);

      let foo2_ = await fooModel.findByPKChecked(2);
      let bar10_ = await barModel.findByPKChecked(10);
      let bar20_ = await barModel.findByPKChecked(20);
      let res = await foo2_.bars.find();
      expect(res.items).to.have.lengthOf(2);
      expect((await bar10_.foo.get())).to.have.property('id', 2);
      expect((await bar20_.foo.get())).to.have.property('id', 2);
    });

    it("should unlink instances", async function () {
      let foo2 = await fooModel.findByPKChecked(2);
      await foo2.bars.linkByPK(10, 20);

      let foo2_ = await fooModel.findByPKChecked(2);
      let bar10_ = await barModel.findByPKChecked(10);
      let bar20_ = await barModel.findByPKChecked(20);
      let res = await foo2_.bars.find();
      expect(res.items).to.have.lengthOf(2);
      expect((await bar10_.foo.get())).to.have.property('id', 2);
      expect((await bar20_.foo.get())).to.have.property('id', 2);

      let bar10 = await barModel.findByPKChecked(10);
      await foo2.bars.unlink(bar10);

      foo2_ = await fooModel.findByPKChecked(2);
      bar10_ = await barModel.findByPKChecked(10);
      bar20_ = await barModel.findByPKChecked(20);
      res = await foo2_.bars.find();
      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('id', 20);
      expect((await bar10_.foo.get())).to.be.null;
      expect((await bar20_.foo.get())).to.have.property('id', 2);
    });

    it("should unlink items matching criteria", async function () {
      let foo = await fooModel.findByPKChecked(2);
      await foo.bars.linkByPK(10, 20);

      let res1 = await (await fooModel.findByPKChecked(2)).bars.find();
      expect(res1.items).to.have.lengthOf(2);

      await foo.bars.unlinkWhere({
        tag: 'lee'
      });

      let res2 = await (await fooModel.findByPKChecked(2)).bars.find();
      expect(res2.items).to.have.lengthOf(1);
      expect(res2.items[0]).to.have.property('id', 10);
    });

    it("searching by a foreign field", async function () {
      let foo = await fooModel.findByPKChecked(2);
      await foo.bars.linkByPK(10);

      let res = await fooModel.find({
        where: {
          bars$tag: 'king'
        }
      });

      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('id', 2);

      res = await fooModel.find({
        where: {
          bars$tag: 'lee'
        }
      });

      expect(res.items).to.have.lengthOf(0);
    });

    it("searching by a reversed foreign field", async function () {
      let foo = await fooModel.findByPKChecked(2);
      await foo.bars.linkByPK(10);

      let res = await barModel.find({
        where: {
          foo$title: 'mockingbird'
        }
      });

      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('id', 10);

      res = await barModel.find({
        where: {
          foo$title: 'mist'
        }
      });

      expect(res.items).to.have.lengthOf(0);
    });

    it("searching by an invalid foreign field should throw", async function () {
      await fooModel.find({
        where: {
          something$title: 'something'
        }
      }).should.eventually.be.rejected;

      await fooModel.find({
        where: {
          bars$title: 'some title'
        }
      }).should.eventually.be.rejected;
    });
  });

  describe("many-to-many relation", function () {
    interface Foo {
      id: number;
      title: string;
      bars: MultiRelation<Foo, Bar, FooBar>;
    }

    interface Bar {
      id: number;
      tag: string;
      foes: MultiRelation<Bar, Foo, FooBar>;
    }

    interface FooBar {
      relationType: string;
    }

    let db: Database;
    let fooModel: Model<Foo>;
    let barModel: Model<Bar>;
    let foobarModel: Model<FooBar>;

    beforeEach(async function() {
      db = await Database.open(':memory:', { shouldCreate: true });

      fooModel = db.define<Foo>('foo', {
        id: { primaryKey: true },
        title: { }
      });

      barModel = db.define<Bar>('bar', {
        id: { typeHint: TypeHint.Integer, primaryKey: true },
        tag: { }
      });

      foobarModel = db.define<FooBar>('foobar', {
        relationType: { }
      });

      fooModel.manyToMany(barModel, 'bars', {
        companionField: 'foes',
        model: 'foobar'
      });

      await db.flushSchema();

      await fooModel.build({ id: 1, title: 'mist' }).$flush();
      await fooModel.build({ id: 2, title: 'mockingbird' }).$flush();

      await barModel.build({ id: 10, tag: 'king' }).$flush();
      await barModel.build({ id: 20, tag: 'lee'}).$flush();
    });

    it("should create access objects", function () {
      expect(fooModel.build({})).to.have.property('bars');
      expect(barModel.build({})).to.have.property('foes');
    });

    it("should return empty list when no instances linked", async function () {
      let foo = fooModel.build({});
      let list = await foo.bars.find();
      console.log(list);
      expect((await foo.bars.find()).items).to.have.lengthOf(0);
      expect((await foo.bars.find()).relationItems).to.have.lengthOf(0);

      let bar = barModel.build({});
      expect((await bar.foes.find()).items).to.have.lengthOf(0);
      expect((await bar.foes.find()).relationItems).to.have.lengthOf(0);

      let foo1 = await fooModel.findByPKChecked(1);
      expect((await foo1.bars.find()).items).to.have.lengthOf(0);
    });

    it("should link two instances", async function () {
      let foo = await fooModel.findByPKChecked(1);
      await foo.bars.linkByPK(10);

      let foo_ = await fooModel.findByPKChecked(1);
      let res1 = await foo_.bars.find();
      expect(res1.items).to.have.lengthOf(1);
      expect(res1.items[0]).to.have.property('id', 10);
      expect(res1.relationItems).to.have.lengthOf(1);

      let bar_ = await barModel.findByPKChecked(10);
      let res2 = await bar_.foes.find();
      expect(res2.items).to.have.lengthOf(1);
      expect(res2.items[0]).to.have.property('id', 1);
      expect(res2.relationItems).to.have.lengthOf(1);
    });

    it("should unlink instances", async function () {
      let foo = await fooModel.findByPKChecked(1);
      await foo.bars.linkByPK(10, 20);

      expect((await foo.bars.find()).items).to.have.lengthOf(2);

      await foo.bars.unlinkByPK(10);

      let res = await foo.bars.find();
      expect(res.items).to.have.lengthOf(1);
      expect(res.relationItems).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('id', 20);
    });

    it("should link instance and relation fields", async function () {
      let foo = await fooModel.findByPKChecked(1);
      await foo.bars.linkByPKUsing(10, {
        relationType: 55
      });

      let res = await foo.bars.find();

      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('id', 10);

      expect(res.relationItems).to.have.lengthOf(1);
      expect(res.relationItems[0]).to.have.property('relationType', 55);
    });

    it("should unlink items matching criteria", async function () {
      let foo = await fooModel.findByPKChecked(1);
      await foo.bars.linkByPKUsing(10, {
        relationType: 55
      });
      await foo.bars.linkByPKUsing(20, {
        relationType: 66
      });

      let res = await foo.bars.find();

      expect(res.items).to.have.lengthOf(2);
      expect(res.relationItems).to.have.lengthOf(2);

      await foo.bars.unlinkWhere({
        relationType: 66
      });

      res = await foo.bars.find();

      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('id', 10);

      expect(res.relationItems).to.have.lengthOf(1);
      expect(res.relationItems[0]).to.have.property('relationType', 55);
    });

    it("searching by a foreign key", async function () {
      let foo = await fooModel.findByPKChecked(1);
      await foo.bars.linkByPKUsing(10, {
        relationType: 55
      });

      let res = await fooModel.find({
        where: {
          bars$tag: 'king'
        }
      });

      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('id', 1);

      let res2 = await fooModel.find({
        where: {
          bars$relationType: 55
        }
      });

      expect(res2.items).to.have.lengthOf(1);
      expect(res2.items[0]).to.have.property('id', 1);

      let res3 = await fooModel.find({
        where: {
          bars$relationType: 66
        }
      });

      expect(res3.items).to.have.lengthOf(0);

      let res4 = await fooModel.find({
        where: {
          bars$relationType: 55,
          bars$tag: 'king'
        }
      });

      expect(res4.items).to.have.lengthOf(1);
      expect(res4.items[0]).to.have.property('id', 1);
    });

    it("searching by a foreign key should not return repeating results", async function () {
      let foo = await fooModel.findByPKChecked(2);
      await foo.bars.linkByPKUsing(10, {
        relationType: 55
      });
      await foo.bars.linkByPKUsing(20, {
        relationType: 55
      });

      let res = await fooModel.find({
        where: {
          bars$relationType: 55
        }
      });

      expect(res.items).to.have.lengthOf(1);
    });

    it("removing by a foreign key", async function () {
      let foo = await fooModel.findByPKChecked(2);
      await foo.bars.linkByPKUsing(10, {
        relationType: 55
      });

      await fooModel.remove({
        where: {
          bars$relationType: 55
        }
      });

      let res = await fooModel.find();
      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0]).to.have.property('id', 1);
    });

    it("updating by a foreign key", async function () {
      let foo = await fooModel.findByPKChecked(2);
      await foo.bars.linkByPKUsing(10, {
        relationType: 55
      });

      await fooModel.update({
        where: {
          bars$relationType: 55
        },
        set: {
          title: 'new title'
        }
      });

      let res = await fooModel.findByPKChecked(2);
      expect(res).to.have.property('id', 2);
      expect(res).to.have.property('title', 'new title');
    });
  });
});
