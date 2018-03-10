## Intro

This template engine can be used to format file names or any other required string values depending on a set of some values.
The language itself is not complicated, and in most aspects is similar to many other template languages.
Input consist of text and blocks surrounded by curly braces.
Inside these brackets you can refer to variables or call functions (built-in or user-defined).
When template is evaluated, these blocks are replaced with resolved values.
The simplest example of a template is a variable name written in curly braces.
Such block will be replaced with computed value of the variable you've written.
For example:

```
/home/user/books/{author} - {title}.pdf
```

after evaluation can become:

```
/home/user/books/J. R. R. Tolkien - Silmarillion.pdf
```

There are some more advanced features the engine can offer.

## Installing

```
npm install --save organic-formatter
```

## Usage

```javascript
const formatter = require('organic-formatter');

let propsObj = {
  'var': 'some value',
  UC_var: 'some value',
  uc: 'SOME VALUE',
  empty: '',
  obj: {
    prop: 'prop value'
  },
  arr: ['first', 'second', 'third']
};

const processor = new formatter.TemplateProcessor(formatter.createPropsResolver(dataObject));
await processor.process('{uc|lowercase}'); // results in 'some value'
```

## Filters

You can process any variable with a set of filters.
For example, `{ title | lowercase }` — converts book's title to lowercase.
You can add as many filters as you want, separating them with | character.
Whitespaces do not matter.

```
{author|lowercase|trim}
```

Filters are applied in the order they are listed in a block, from the leftmost to the rightmost.
Each filter is a mere function and can receive other arguments that you can list in round brackets after function name.
For example: `{ series_index | pad_left(3, '0') }` will be evaluated as `007` if series_index is 7.
Here you process `series_index` with a filter `pad_left` which is a function getting exactly three arguments, first being the processed string (or output of the previous filter in chain).
This function gets a string and, if the string is shorter than some required length, pads it with some character from the left for it to have minimum length.
First argument is the resolved value of `series_index`.
Second one is minimal length of string we want to get.
Third one is a string which be used to pad value if it is shorted than required.
Each filter gets a result of previous filter in chain as its first argument.
If filter is the first one in the chain (right after the variable, as pad_left in the example above) it gets resolved value of the variable instead.
A very first value in a block (in most cases, the value of the variable you write right after opening a block) is called a head value of a block.

## Strings

Strings that you pass to functions must be wrapped in single or double quotes.
Inside these strings you can use a limited set of escape sequences to mention special characters.
For example, if you need to include a single quote inside your string, you cannot do it directly, as it will close string literal instead.
You should prepend this quote with backslash character as in the following example:

```
{ title | wrap('\'@\'') } — will wrap `title` in single quotes.
```

Backslash itself also should be escaped (write \\ whenever you want a string with a backslash).

Only \\ \' \" \n \r \t \b sequences can be used.
Any other escape sequence is not supported and will trigger an error while parsing the template.

## Numbers

You can use integer numbers too.
No floating-point numbers are supported.
Although a function can get a string with floating number and parse it to use this number.
Numbers and strings are interchangeable.
You can use a number instead of a string and vise versa.
You can wrap a number in quotes where function expects a number, and write your string without quotes if it represents a number.
Everything will work fine.
We've used `pad_left` function as a filter before, and have wrote it in this way:

```
{ series_index | pad_left(3, '0') }
```

But you could write it in this way too:

```
{ series_index | pad_left(3, 0) }
```

There will be no error.
Template engine internally converts numbers to strings before passing them to functions.
A function should parse a string if it wants a number, and use the parsed value if required.

## Nested calls

You can use a result of another function as an argument.
Example:

```
{ author | func(func2(a), b) }
```

## Identifiers and specifiers

Variables and functions names are identifiers.
An identifier consists of latin alphabetic characters, digits and some other characters: _ . @ #
Only letter or underscore can be the first character of an identifier.
The hash character (#) has special meaning for variable names.
It should not be used in function names, but this rule is not enforced.
Hash divides an identifier into two parts: one before the hash is actual name of a variable, one after the hash is called specifier.
An specifier modifies the process of resolving a variable.
How specifier is interpreted depends on a resolver.
For example, a specifier can be used to access a specified element of an array.
`{ tag#2 }` will be resolved to second element of the array of tags.
Different resolvers can offer another meanings for specifiers.

## Optional blocks

There can be a question mark in the beginning of a block.
It means that if the first resolved value of the block is an empty string, resolving process should stop and do not apply any other filters to this empty string.
It can be useful, for example, when you want some value to be surrounded with some text, but only if the value exists.
Using such code: `{var|wrap('[@]')}` produces two brackets without any text between them if `var` is resolved to an empty string.
But using the following code: `{?var|wrap('[@]')}` is this case produces nothing and will be evaluated to an empty string itself when 'var' is empty.

## Function calls

When function is called without arguments, you can omit braces.
But you can also write it, it changes nothing.
For example, two following examples are totally equivalent: `{var|lowercase}` and `{var|lowercase()}`

## Variable resolving

Variables are resolved to its values by resolvers.
A resolver can either resolve a variable or not.
A resolver fails to resolve a variable, for example, if it knows nothing about it (but another resolve can use a some default value instead).
In this case variable is considered to be an empty string.
For example, if there is no variable named `gopher`, the following template:

```
Look, here is a gopher: {gopher}. Did you see it?
```

will be evaluated to the following string:

```
Look, here is a gopher: . Did you see it?
```

Yeah, you didn't see the gopher.
Me too.
But it does exist.
It was evaluated to an empty string.
Such behavior can be helpful in most cases, but you can set a `strictVarResolve` flag on TemplateProcessor and any variable that cannot be resolved will result in an error.
So you will not be able to evaluate this template at all.

When you write an identifier without braces, it can be interpreter either as a variable or a function call without arguments.
It is unwanted situation when variable name collates with a name of a function, but you should know that variable will be tried first.
If all resolves will fail to resolve a variable, it will be considered to be a function call.
If there is no function too, the identifier will not be resolved and will result in either considering it to be an empty string or throwing an error (if `strictVarResolve` flag is set).

## Function result as the first variable

You can use a function instead of a plain variable to get a head value of a block.
Just write it:

```
{ generate_some_value(123) | lowercase }
```

## Built-in functions

`lowercase`

`upppercase`

`trim`

`def` --- if first argument is empty, returns some other value instead

`propercase` --- converts string to proper case (ex., `thIs is some title` -> `This is Some Title`)

`add` --- converts arguments to numbers are sums them

`sub`

`wrap` --- outputs its second argument, replacing `@` symbol with the value of first argument

`_lorem` --- outputs `n` words of lorem ipsum

`list` --- takes arguments and converts them to list

`join` --- joins list items with separator

`now` --- returns current date

`format_date` --- formats date using moment.js

`format_num` --- formats number using numeral library.
