/*
This poorly commented file contains the `Component` base class that components can extend to get advanced template rendering options and data reactivity.
*/

const variableInterpolation = /@(\w[\w\d\.]*)\b/g;
const arrayMutations = ['push', 'pop', 'unshift', 'shift'];

class Component extends HTMLElement {
  isComponent = true;
  componentName = null;

  template = null;
  shadowRoot = null;
  parentComponent = null;

  hasInitialized = false;
  _data = null;
  // mapping of data dependencies
  _deps = {
    keys: []
  };
  _currentNode = null;

  onNextTick = [];

  constructor (templateId) {
    super();

    this.componentName = templateId;

    this.template = document.querySelector(`template#${templateId}`).cloneNode(true);
    if (!this.template) {
      throw new Error(`Cannot instantiate component because the template with id '${templateId}'' does not exist.`);
    }

    this.shadowRoot = this.attachShadow({ mode: 'open' });

    setTimeout(() => {
      if (!this.hasInitialized) {
        this.initialize();
      }
    }, 0);
  }

  initialize () {
    this.hasInitialized = true;

    let ancestor = this.parentNode;
    while (ancestor) {
      if (ancestor.isComponent) {
        this.parentComponent = ancestor;
        break;
      }

      if (ancestor.host) {
        ancestor = ancestor.host;
      } else {
        ancestor = ancestor.parentNode;
      }
    }
    if (!this.parentComponent) {
      this.parentComponent = {
        _data: window
      };
    }

    const props = {};
    for (const attr of Object.values(this.attributes).filter(attr => attr.name.startsWith(':'))) {
      // remove leading ':'
      let key = attr.name.slice(1);
      // convert slug-case to camelCase
      key = key.replace(/-(\w)/g, (_, c) => c.toUpperCase());
      props[key] = this.getAttrValue(attr.value, { ...this.parentComponent._data, ...this.context });
    }

    if (this.data) {
      // get data and make it reactive
      this._data = this.reactive({
        ...this.data(),
        ...props
      });
    } else {
      this._data = this.reactive(props);
    }

    this.created?.();
    this.run(true);
  }

  nextTick (func) {
    this.onNextTick.push(func);
  }

  run (first = false) {
    // runs logic for the component.  if something has changed, it re-renders
    const hasChanged = this._deps.keys.reduce((prev, current) => prev || this._deps[current].hasChanged, false);
    if (hasChanged || first) {
      this.render(first);
      if (first) {
        this.mounted?.();
      }
      this.rendered?.();
    }

    let nextTick;
    while (nextTick = this.onNextTick.pop()) {
      nextTick();
    }

    requestAnimationFrame(() => {
      // since the logic is quite heavy & manipulates the DOM, we don't want to perform it during the animation frame
      // but we don't want it to happen more than once per frame
      // so we combine requestAnimationFrame with timeout(0)
      setTimeout(this.run.bind(this, false), 0);
    });
  }

  render (first = false) {
    // renders the component
    let changedNodes = [];
    if (first) {
      changedNodes = this.template.content.childNodes;
    } else {
      for (const key of this._deps.keys) {
        // check if this dependency has changed
        if (this._deps[key].hasChanged) {
          changedNodes = changedNodes.concat([ ...this._deps[key].dependents ]);
          this._deps[key].hasChanged = false;
        }
      }
    }

    this.walkNodes(changedNodes, this.renderNode.bind(this));

    if (first) {
      this.shadowRoot.appendChild(this.template.content);
    }
  }

  walkNodes (nodeList, action, context = {}) {
    // walks over a set of nodes in a nodelist and performs an `action`
    for (const node of nodeList) {
      if (node.isIterative) {
        continue;
      }
      node.context = context;
      const clonedNode = action(node);
      if (clonedNode.childNodes.length > 0) {
        this.walkNodes(clonedNode.childNodes, action, context);
      }
    }
  }

  renderNode (node) {
    // create a clone of the template for this node and replace the old node with the clone
    const oldNode = node;

    if (node.isComponent) {
      if (!node.hasInitialized) {
        node.initialize();
      } else {
        // update component props rather than re-create the component
        for (const [key, value] of Object.entries(node.context).concat(Object.entries(this._data))) {
          if (node._data[key] !== value) {
            node._data[key] = value;
          }
        }

        // re-render the component
        node.render();
      }
      return node;
    } else if (node._template) {
      node = node._template.cloneNode(true);
      node._template = oldNode._template;
    } else {
      node = node.cloneNode();
      node._template = oldNode;
    }

    while (oldNode.firstChild) {
      node.appendChild(oldNode.firstChild);
    }

    node.isIterative = oldNode.isIterative;
    node.context = oldNode.context;
    node._key = oldNode._key;

    oldNode.parentNode.replaceChild(node, oldNode);
    this.removeFromDependencies(oldNode);
    this._currentNode = node;

    // check for iteration on this node (:for attrs)
    const forDirective = node.attributes?.[':for'];
    if (forDirective && !node.isIterative) {
      const keyDirective = node.attributes?.[':key'];
      if (!keyDirective) {
        throw new Error(`Node with :for="${forDirective.value}" has no :key`);
      }

      // add the iteration variable to the context and return it
      const matches = /(\w[\w\d]*) of (\w[\w\d]*)/.exec(forDirective.value);
      if (matches && matches[1] && matches[2]) {
        // get sibling keys for the node
        let siblingKeys = [];
        for (const siblingNode of node.parentNode.childNodes) {
          if (siblingNode._key) {
            siblingKeys.push(siblingNode._key);
          }
        }

        const replacementNode = new Comment(`:for="${forDirective.value}"`);
        replacementNode._template = node.cloneNode(true);
        replacementNode.context = node.context;
        this._currentNode = replacementNode;
        const iterable = this.evalPath(node.context, matches[2]) ?? this.evalPath(this._data, matches[2]);
        if (iterable) {
          let previousSibling = node;
          for (let i = 0; i < iterable.length; i++) {
            const itemPath = `${matches[2]}[${i}]`;

            let clone = node.cloneNode(true);
            clone.removeAttribute(':for');
            clone._template = clone.cloneNode();
            clone.context = {
              ...node.context,
              [matches[1]]: this.evalPath(node.context, itemPath) ?? this.evalPath(this._data, itemPath)
            };
            clone.isIterative = true;

            const key = this.evalPath(clone.context, keyDirective.value);
            if (!key) {
              throw new Error('Key should be based on iteration.');
            }
            clone._key = key;
            // check if key exists in siblings, if so, remove from sibling list, else, add to node list
            if (siblingKeys.includes(key)) {
              siblingKeys = siblingKeys.filter(k => k !== key);
              const existingNode = [ ...node.parentNode.childNodes ].find(n => n._key === key);
              node.parentNode.insertBefore(existingNode, previousSibling.nextSibling);
              previousSibling = existingNode;
            } else {
              node.parentNode.insertBefore(clone, previousSibling.nextSibling);
              clone = this.renderNode(clone);
              this.walkNodes(clone.childNodes, this.renderNode.bind(this), clone.context);
              previousSibling = clone;
            }
          }

          // any siblings matching a remaining key should be removed
          let siblingNode = node.parentNode.firstChild;
          while (siblingNode) {
            if (siblingNode._key && siblingKeys.includes(siblingNode._key)) {
              siblingNode.parentNode.removeChild(siblingNode);
            }
            siblingNode = siblingNode.nextSibling;
          }
        }
        node.parentNode.replaceChild(replacementNode, node);
        node = replacementNode;
      } else {
        throw new Error(`SyntaxError in :for expression: '${forDirective.value}'`);
      }
    }

    // compute conditionals (:if attrs)
    const ifDirective = node.attributes?.[':if'];
    if (ifDirective) {
      const replacementNode = new Comment(`:if="${ifDirective.value}"`);
      replacementNode._template = node.cloneNode(true);
      replacementNode.context = node.context;
      this._currentNode = [replacementNode, node];
      if (!this.getAttrValue(ifDirective.value, this._data)) {
        this.removeFromDependencies(node);
        node.parentNode.replaceChild(replacementNode, node);
        node = replacementNode;
      } else {
        this.removeFromDependencies(replacementNode);
        node.removeAttribute(':if');
        // clear the children from the template, if present
        while (node._template.firstChild) {
          node._template.removeChild(node._template.firstChild);
        }
      }
    }

    // event bindings
    const events = node.attributes
      ? Object.values(node.attributes).filter(a => a.name.startsWith('~'))
      : [];
    for (const event of events) {
      const e = event.name.slice(1);
      const method = event.value;
      if (typeof this[method] === 'function') {
        node.addEventListener(e, this[method].bind(this));
      } else {
        throw new Error(`'${method}' is not a method on component '${this.componentName}'`);
      }
    }

    // attr bindings
    const specialDirectives = [':if', ':for'];
    const bindings = node.attributes
      ? Object.values(node.attributes).filter(a => a.name.startsWith(':') && !specialDirectives.includes(a.name))
      : [];
    for (const binding of bindings) {
      node.setAttribute?.(
        binding.name.slice(1),
        this.evalPath(node.context, binding.value) ?? this.evalPath(this._data, binding.value)
      );
    }

    // replace variables in the template
    if (node.wholeText && node.parentNode.tagName !== 'STYLE') {
      node.textContent = node.wholeText.replace(variableInterpolation, (match, varName) => {
        return this.evalPath(node.context, varName) ?? this.evalPath(this._data, varName);
      });
    }

    this._currentNode = null;
    return node;
  }

  reactive (src, topKey = null) {
    if (typeof src !== 'object') {
      return src;
    }

    if (topKey && Array.isArray(src)) {
      for (const mutation of arrayMutations) {
        const old = src[mutation];
        src[mutation] = (...args) => {
          this._deps[topKey].hasChanged = true;
          old.call(src, ...args);
        };
      }
    }

    // recurse over the entries in an object and redefine them to be reactive
    const self = this;
    for (const [key, value] of Object.entries(src)) {
      let reactiveValue = value;
      if (value && typeof value === 'object') {
        reactiveValue = this.reactive(value);
      }

      if (typeof key === 'string' && isNaN(key[0])) {
        (() => {
          let _v = reactiveValue;
          delete src[key];
          const _depKey = Symbol(`dep:${key}`);
          self._deps.keys.push(_depKey);
          self._deps[_depKey] = {
            hasChanged: false,
            dependents: new Set()
          };

          if (Array.isArray(_v)) {
            for (const mutation of arrayMutations) {
              const old = value[mutation];
              value[mutation] = (...args) => {
                self._deps[_depKey].hasChanged = true;
                old.call(value, ...args);
              };
            }
          }

          Object.defineProperty(src, key, {
            get () {
              if (self._currentNode) {
                if (Array.isArray(self._currentNode)) {
                  for (const node of self._currentNode) {
                    self._deps[_depKey].dependents.add(node);
                  }
                } else {
                  self._deps[_depKey].dependents.add(self._currentNode);
                }
              }
              return _v;
            },
            set (_vNew) {
              if (_vNew !== _v) {
                _v = self.reactive(_vNew, _depKey);
                window.___depKey = _depKey;
                self._deps[_depKey].hasChanged = true;
              }
            }
          })
        })();
      } else {
        src[key] = reactiveValue;
      }
    }
    return src;
  }

  removeFromDependencies (node) {
    for (const key of this._deps.keys) {
      if (this._deps[key].dependents.has(node)) {
        this._deps[key].dependents.delete(node)
      }
    }
  }

  evalPath (obj, path) {
    // evaluates a string path expression like 'obj.prop.foo' to a value
    path = path.split(/[.\[\]]/);
    path = path.filter(p => p !== '');
    let val = obj?.[path[0]];
    path.shift();
    for (const part of path) {
      if (isNaN(part)) {
        val = val?.[part];
      } else {
        val = val?.[+part];
      }
    }
    return val;
  }

  getAttrValue (text, data) {
    if (text === 'true') {
      return true;
    } else if (text === 'false') {
      return false;
    } else if (!isNaN(text)) {
      return +text;
    } else if (/^['"].*['"]$/.test(text)) {
      return text.slice(1, text.length - 1);
    } else {
      // try evaluating it as a path
      return this.evalPath(data, text);
    }
  }
}
