# [![](https://i.imgur.com/rb8oPur.png)](http://turbo.github.io)

turbo.js is a small library that makes it easier to perform complex calculations that can be done in parallel. The actual calculation performed (the *kernel* executed) uses the GPU for execution. This enables you to work on an array of values all at once.

turbo.js is compatible with all browsers (even IE when not using ES6 template strings) and most desktop and mobile GPUs.

**For a live demo and short intro, please visit [turbo.github.io](http://turbo.github.io).**

![](https://i.imgur.com/BiiQSzP.png)

### Example 1

For this example, which can also be found at the aforementioned website, we are going to perform a simple calculation on a big-ish array of values.

First, include turbo.js in your site:

```html
<script src="https://turbo.github.io/js/turbo.js"></script>
```

or pull [`turbojs`](https://www.npmjs.com/package/turbojs) via npm to use it in your project.

turbo.js only has two functions that can be called by your code. Both are contained within the `turbojs` object. If this object is not initialized, something went wrong. So the first step is to check for turbo.js support. You can optionally check for exceptions thrown by turbo.js, which will provide further details on the error.

```js
if (turbojs) {
  // yay
}
```

Now we need some memory. Because data has to be transferred to and from GPU and system memory, we want to reduce the overhead this copy operation creates. To do this, turbo.js provides the `alloc` function. This will reserve memory on the GPU and in your browser. JavaScript can access and change contents of allocated memory by accessing the `.data` sub-array of a variable that contains allocated memory.

For both turbo.js and JavaScript, the allocated memory is strictly typed and represents a one-dimensional array of 32bit IEEE floating-point values. Thus, the `.data` sub-array is a standard JavaScript [`Float32Array`](https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Float32Array) object. After allocation, you can interact with this array however you want, except for changing it's size. Doing so will result in undefined behavior.

```js
if (turbojs) {
  var foo = turbojs.alloc(1e6);
}
```

We now have an array with 1,000,000 elements. Let's fill it with some data.

```js
if (turbojs) {
  var foo = turbojs.alloc(1e6);

  for (var i = 0; i < 1e6; i++) foo.data[i] = i;

  // print first five elements
  console.log(foo.data.subarray(0, 5));
}
```

Running this, the console should now display `[0, 1, 2, 3, 4]`. Now for our simple calculation: Multiplying each value by `nFactor` and printing the results:

```js
if (turbojs) {
  var foo = turbojs.alloc(1e6);
  var nFactor = 4;

  for (var i = 0; i < 1e6; i++) foo.data[i] = i;

  turbojs.run(foo, `void main(void) {
    commit(read() * ${nFactor}.);
  }`);

  console.log(foo.data.subarray(0, 5));
}
```

The console should now display `[0, 4, 8, 12, 16]`. That was easy, wasn't it? Let's break done what we've done:

- `turbojs.run`'s first parameter is the previously allocated memory. The second parameter is the code that will be executed for each value in the array.
- The code is written in an extension of C called GLSL. If you are not familiar with it, there is some good documentation on the internet. If you know C (or JS and know what types are), you'll pick it up in no time.
- The kernel code here consists just of the main function, which takes no parameters. However, kernels can have any number of functions (except zero).
- The `read()` function reads the current input value.
- `${nFactor}` is substituted by the value of `nFactor`. Since GLSL expects numerical constant expressions to be typed, we append a `.` to mark it as a float. Otherwise the GLSL compiler will throw a type error.
- `commit()` writes the result back to memory. You can `commit` from any function, but it is good practice to do so from the last line of the `main` function.

### Example 2: Working with vectors

That's great. But sometimes you need to return more than a single value from each operation. Well, it might not look like it, but we've been doing that all along. Both `commit` and `read` actually work on 4-dimensional vectors. To break it down:

- `vec4 read()` returns the GLSL data type `vec4`.
- `void commit(vec4)` takes a `vec4` and writes it to memory

A `vec4` is basically just an array. You could say it's akin to `foobar = {r:0, g:0, b:0, a:0}` in JS, but it's much more similar to JavaScript [`SIMD`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SIMD)'s `Float32x4`.

The nice thing about GLSL is that all operations are overloaded so that they can work with vectors without the need to deal with each element individually, so

```GLSL
commit(vec4(read().r * 4., read().g * 4., read().b * 4., read().a * 4.));
```

is equivalent to

```GLSL
commit(read() * 4.);
```

Neat, huh? Of course there are other types of vectors in GLSL, namely `vec2` and `vec3`. If you create a bigger vector and supply a smaller one as a parameter, GLSL will automatically align the values:

```GLSL
vec2 foo = vec2(1., 2.);

commit(vec4(foo.r, foo.g, 0., 0.));

// is the same as

commit(vec4(foo.rg, 0., 0.));
```

So we'll use that right now. If you visit the website mentioned above, you will get results from a simple benchmark comparing JS to JS + turbo.js. The benchmark calculates random points on a mandelbrot fractal. Let's break down what happens there, starting with the JavaScript code:

For each run, the first two values of each `vec4` of the allocated memory are filled with random coordinates as the input for the fractal function:

```js
for (var i = 0; i < sampleSize; i += 4) {
  testData.data[i] = Math.random();
  testData.data[i + 1] = Math.random();
}
```

For each operation, the result will be a greyscale color value. That will be written to the third (i.e. `b`) component of each vector:

```js
function testJS() {
	for (var i = 0; i < sampleSize; i += 4) {
		var x0 = -2.5 + (3.5 * testData.data[i]);
		var y0 = testData.data[i + 1], x = 0, y = 0, xt = 0, c = 0;

		for (var n = 0; n < sampleIterations; n++) {
			if (x * x + y * y >= 2 * 2) break;

			xt = x * x - y * y + x0;
			y = 2 * x * y + y0;
			x = xt;
			c++;
		}

		var col = c / sampleIterations;

		testData.data[i + 2] = col;
	}
}
```

The fractal is calculated to the iteration depth of `sampleIterations`. Now let's take a look at the turbo.js code performing the same task:

```js
function testTurbo() {
	turbojs.run(testData, `void main(void) {
		vec4 ipt = read();

		float x0 = -2.5 + (3.5 * ipt.r);
		float y0 = ipt.g, x, y, xt, c;

		for(int i = 0; i < ${sampleIterations}; i++) {
			if (x * x + y * y >= 2. * 2.) break;

			xt = x * x - y * y + x0;
			y = 2. * x * y + y0;
			x = xt;
			c++;
		}

		float col = c / ${sampleIterations}.;

		commit(vec4(ipt.rg, col, 0.));
	}`);
}
```

Notice how easy the JS code can be translated to GLSL and vice versa, as long as no exclusive paradigms are used. Of course this example is not the optimal algorithm in JS or GLSL, this is just for comparison.

### Example 3: Debugging

GLSL code is compiled by your GPU vendor's compiler. Usually these compilers provide verbose error information. You can catch compile-time errors by catching exceptions thrown by turbo.js. As an example, consider this invalid code:

```js
if (turbojs) {
  var foo = turbojs.alloc(1e6);
  var nFactor = 4;

  turbojs.run(foo, `void main(void) {
    commit(${nFactor}. + bar);
  }`);
}
```

This will generate two errors. The first one is `bar` being undefined. The second one is a type mismatch: `commit` expects a vector, but we've just given it a float. Opening your browser's console will reveal the error:

![](https://i.imgur.com/49Z6Fei.png)

### Further considerations

- Always provide a JS fallback if you detect that turbo.js is not supported.
- Use web workers for huge datasets to prevent the page from blocking.
- Always warm-up the GPU using dummy data. You won't get the full performance if you don't.
- In addition to error checking, do a sanity check using a small dataset and a simple kernel. If the numbers don't check out, fall back to JS.
- I haven't tried it, but I guess you can adapt [glsl-transpiler](https://github.com/stackgl/glsl-transpiler) to create JS fallback code automatically.
- Consider if you *really* need turbo.js. Optimize your *algorithm* (not code) first. Consider using JS SIMD. turbo.js can't be used for non-parallel workloads.

Make sure to familiarize yourself with the GLSL standard, which can be found at [OpenGL.org](https://www.opengl.org/registry/doc/GLSLangSpec.4.40.pdf).

Follow best practices to reduce your algorithm complexity. MDN adds:

> Simpler shaders perform better than complex ones. In particular, if you can remove an if statement from a shader, that will make it run faster. Division and math functions like `log()` should be considered expensive too.

Many C shorthands apply to GLSL. Having said that, this also applies:

> However, nowadays even mobile devices possess powerful GPUs that are capable of running even relatively complex shader programs. Moreover, because shaders are compiled, the eventual machine code that actually runs on the hardware may be highly optimized. What may seem like an expensive function call may in fact compile into only few (or even a single) machine instructions. This is particularly true for GLSL functions that typically operate on vectors, such as `normalize()`, `dot()` and `mix()`. The best advice in that regard is to use the built-in functions, rather than try to implement, for example, one's own version of a dot-product or linear interpolation, which may in fact compile to larger and less optimized machine code. Finally, it is important to keep in mind that GPUs are constructed to do complex mathematical calculations in hardware, and therefore, may support math functions, such as `sin()`, `cos()` and other, through dedicated machine instructions.
