# [![](http://i.imgur.com/rb8oPur.png)](http://turbo.github.io)

turbo.js is a small library that makes it easier to perform complex calculations that can be done in parallel. The actual calculation performed (the *kernel* executed) uses the GPU for execution. This enables you to work on an array of values all at once.

turbo.js is compatible with all browsers (even IE when not using ES6 template strings) and most desktop and mobile GPUs. For a live demo and short intro, please visit [turbo.github.io](http://turbo.github.io).

### Example 1

For this example, which can also be found at the beforementioned website, we are going to perform a simple calculation on a big-ish array of values.

turbo.js only has two functions that can be called by your code. Both are contained within the `turbojs` object. If this object is not initialized, something went wrong. So the first step is to check for turbo.js support. You can optionally check for exceptions thrown by turbo.js, which will provide further details on the error.

```js
if (turbojs) {
  // yay
}
```

Now we need some memory. Because data has to be transferred to and from GPU and system memory, we want to reduce the overhead this copy operation creates. To do this, turbo.js provides the `alloc` function. This will reserve memory on the GPU and in your browser. JavaScript can access and change contents of allocated memory by accessing the `.data` sub-array of a variable that contains allocated memory.

For both turbo.js and JavaScript, the allocated memory is strictly typed and represents a one-dimensional array of 32bit IEEE floating-point vlaues. Thus, the `.data` sub-array is a standard JavaScript [`Float32Array`](https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Float32Array) object. After allocation, you can interact with this array however you want, except for changing it's size. Doing so will result in undefined behavior.
