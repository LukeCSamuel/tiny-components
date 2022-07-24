# Tiny Components

This repo is just a place to put a really rough draft of a reactive-template Component model I threw together on a Saturday because I had nothing better to do.

## Using Tiny Components

Tiny Components is built to use the Web Components API.  A Component is a class that extends the provided base class `Component` and provides the super with the id of the `<template>` element which contains the component's HTML template.

## Component Class

The simplest component class is:

```js
class MyComponent extends Component {
  constructor () {
    super('my-component');
  }
}

customElements.define('my-component', MyComponent);
```

Components can override the following methods to get additional behavior:

| Method | Description |
| --- | --- |
| `data()` | Should return an object.  Properties on the object will be made reactive and merged with properties defined in the template under `this._data`. |
| `created()` | Called after the component is first created & initialized w/ data, but before template rendering. |
| `mounted()` | Called after the *first* time the component is rendered (before `rendered()`). |
| `rendered()` | Called after *every* time the component is rendered. |

Additionally, the `Component` base class provides a `this.nextTick` function which accepts as a parameter a function to be executed after the next render operation finishes.

## Templating

Templates are basically HTML but with some sugar.

### Text Interpolation

Text content can be interpolated by using `@path.to.var` where `path` should exist on the `_data` object created for the component [(where could I have possibly been inspired???)](https://dotnet.microsoft.com/en-us/apps/aspnet/web-apps/blazor).

E.g.
```html
<p>
  @someData
</p>
```

Note that it's impossible to escape the `@` character. If it's followed by a valid identifier path, like `@example.com`, Tiny Components will try to interpolate it no matter what.  There are 2 incredibly important reasons for this:

1. it prevents developers from hard-coding email addresses in the HTML
2. i have yet to need this feature, so i have yet to implement it.  lmao.

### Attribute Binding

Attribute values can be bound by prefixing the attribute with `:` [(again completely original!!)](https://vuejs.org/).

E.g.
```html
<div :id="someData"></div>
```

### If but not else

Tiny Components supports if statements.  It doesn't support else statements.  Confusingly I decided to make if statements look like bindings:

```html
<div :if="shouldShowThisElement">
</div>
```

### For the sake of iteration

Tiny Components can do iternumeration to some extent somewhat well some of the time.  If you find a bug, it will probably be either here, or with reactivity.  It also looks like attribute binding because legibility was an afterthought:

```html
<div :for="item of items" :key="item.id">
</div>
```

Notice that `:key`?  It's required.  Like actually really required.  If you like things to work as expected, it needs to be unique (and not just unique to the `:for`, it needs to be unique to the parent element of the `:for` element, because quirks are cute).  Within the `:for`'d element & its decendents, you have access to the `:for` variable context:

```html
<div :for="item of items" :key="item.id">
  <h1 :if="item.title">@item.title</h1>
  <p>@item.description</p>
</div>
```

### Event Binding

Legibility was an afterthought but after a while I thought about it and decided !!not!! to make event binding start with `:` as well (arguably not for the sake of legibility but for the sake of how the fuck do I distinguish events from attributes?).  Instead events are defined using one of these swOOshyy bois: `~`  The first part is the event name to be bound.  The second part is the name of a method on the component class to be called with the event parameters when the event fires.

```html
<button ~click="handleClick" style="background:#b22;width:69px;height:69px;border-radius:100vw;" aria-label="Please do not click this big red button"></button>
```

## Other things worth writing about

Notice that there is no mention of expressions within templates.  This is because putting expressions in your template is stupid and shouldn't be done.  Code files are for code.  Markup files are for markup.  And also because I didn't want to write the code to support it.

On the subject of reactivity: it exists.  It is not super well thought out.  69% of the time it works every time.  Like other libraries that provide reactivity, it uses accessors and method replacement, meaning creating new properties using indexing or indexing on numbers a la array will not cause it to react.  Furthermore, reactivity is pretty closely linked to the rendering system.  The only reaction you'll get from the reactivity is re-rendering dependent template nodes.  There is no such thing as a "computed property" or any other form of data reactivity, at least right now (likely ever, I start things, I don't finish them).  Also, there are several places where objects are re-created rather than re-used (component instantiating, cloning of `:for` nodes to create contextual variables) and reactivity very well probably may conceivably likely not work through these barriers.  Don't modify a variable in a child component and expect its source in the parent component to update (obligatory "would be cool if it did").  More frustratingly, don't modify an iteratable item in a parent component and expect the child component to update.  It probably won't.
