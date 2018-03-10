Simple and dirty TypeScript-friendly ORM for Sqlite on Node.js.

## Installing

```
npm install --save organic-orm
```

## Usage

```javascript
const orm = require('organic-orm');

const db = await orm.Database.open(':memory:');
```

TypeScript typings come out-of-box.

## Define model

```typescript
interface Foo {
  name: string;
  value: string;
}

db.define<Foo>('user', {
  id: { typeHint: orm.TypeHint.Integer, primaryKey: true },
  firstName: { typeHint: orm.TypeHint.Text }
});
await db.flushSchema();
```

