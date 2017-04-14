(function (root, factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define([], factory);
	} else if (typeof module === 'object' && module.exports) {
		// Node. Does not work with strict CommonJS, but
		// only CommonJS-like environments that support module.exports,
		// like Node.
		module.exports = factory();
	} else {
		// Browser globals (root is window)
		root.turbojs = factory();
	}
}(this, function () {

	// turbo.js
	// (c) turbo - github.com/turbo
	// MIT licensed

	"use strict";

	// [BUGLOG]
	// - Sizes over n for !~bandWidth only display roughly n/4 results
	// - Add feature query for platforms w/o vectorized float shaders
	// -
	// -

	// Mozilla reference init implementation
	var initGLFromCanvas = function(canvas) {
		var gl = null;
		var attr = {alpha : false, antialias : false};

		// Try to grab the standard context. If it fails, fallback to experimental.
		gl = canvas.getContext("webgl", attr) || canvas.getContext("experimental-webgl", attr);

		// If we don't have a GL context, give up now
		if (!gl)
			throw new Error("turbojs: Unable to initialize WebGL. Your browser may not support it.");

		return gl;
	}

	var gl = initGLFromCanvas(document.createElement('canvas'));

	// Default to 32x4 bit
	//~ var bandWidth = (!gl.getExtension('OES_texture_float')) ? -1 : 1;
	var bandWidth = -1;
	if (!~bandWidth)
		console.warn("turbo.js: Warning, vectorized kernels unavailable in this device.");

	// GPU texture buffer from JS typed array
	function newBuffer(data, f, e) {
		var buf = gl.createBuffer();

		gl.bindBuffer((e || gl.ARRAY_BUFFER), buf);
		gl.bufferData((e || gl.ARRAY_BUFFER), new (f || Float32Array)(data), gl.STATIC_DRAW);

		return buf;
	}

	var positionBuffer = newBuffer([ -1, -1, 1, -1, 1, 1, -1, 1 ]);
	var textureBuffer  = newBuffer([  0,  0, 1,  0, 1, 1,  0, 1 ]);
	var indexBuffer    = newBuffer([  1,  2, 0,  3, 0, 2 ], Uint16Array, gl.ELEMENT_ARRAY_BUFFER);

	var vertexShaderCode =
	`attribute vec2 position;
	varying vec2 pos;
	attribute vec2 texture;

	void main(void) {
		pos = texture;
		gl_Position = vec4(position.xy, 0.0, 1.0);
	}`;

	var stdlib =
	`precision mediump float;
	uniform sampler2D u_texture;
	varying vec2 pos;

	vec4 std_ftoa(float v) {
		float av = abs(v);

		if (av < 1.17549435e-38) return vec4(0.0);
		if (v  > 1.70141184e38)  return vec4(127.0, 128.0, 0.0, 0.0) / 255.0;
		if (v  < -1.70141184e38) return vec4(255.0, 128.0, 0.0, 0.0) / 255.0;

		vec4 c = vec4(0.);

		float e = floor(log2(av));
		float m = av * pow(2.0, -e) - 1.0;

		c[1] = floor(    128.0 * m); m -= c[1] /   128.0;
		c[2] = floor(  32768.0 * m); m -= c[2] / 32768.0;
		c[3] = floor(8388608.0 * m);

		float ebias = e + 127.0;
		c[0]  = floor(ebias  /   2.0); ebias -= c[0] * 2.0;
		c[1] += floor(ebias) * 128.0;
		c[0] += 128.0 * step(0.0, -v);

		return c / 255.0;
	}

	float std_atof(vec4 rgba) {
		rgba *= 255.0;
		float s = 1.0 - step(128.0, rgba[0]) * 2.0;
		float e = 2.0 * mod(rgba[0], 128.0) + step(128.0, rgba[1]) - 127.0;
		return s * exp2(e - 23.) * (mod(rgba[1], 128.0) * 65536.0 + rgba[2] * 256.0 +rgba[3] + float(0x800000));
	}

	${~bandWidth ? '#define tb_Vectorized' : ''}

	#ifdef tb_Vectorized

	vec4 read(void) {
		return texture2D(u_texture, pos);
	}

	void commit(vec4 val) {
		gl_FragColor = val;
	}

	#else

	float read(void) {
		return std_atof(texture2D(u_texture, pos));
	}

	void commit(float distance) {
		gl_FragColor = std_ftoa(distance);
	}

	#endif

	#line 1
	`;

	var vertexShader = gl.createShader(gl.VERTEX_SHADER);

	gl.shaderSource(vertexShader, vertexShaderCode);
	gl.compileShader(vertexShader);

	// This should not fail.
	if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS))
		throw new Error(
			"\nturbojs: Could not build internal vertex shader (fatal).\n" + "\n" +
			"INFO: >REPORT< THIS. That's our fault!\n" + "\n" +
			"--- CODE DUMP ---\n" + vertexShaderCode + "\n\n" +
			"--- ERROR LOG ---\n" + gl.getShaderInfoLog(vertexShader)
		);

	// Transfer data onto clamped texture and turn off any filtering
	function createTexture(data, size) {
		var texture = gl.createTexture();

		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

		if (~bandWidth) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.FLOAT, data);
		} else {
			var sizeMap = size * size;
			var input8bit = new Uint8Array(sizeMap * 4);

			for (var i = 0; i < sizeMap; i++) {
				var valBytes = toIEEE754Single(data[i]);

				input8bit[4*i + 0] = valBytes[0];
				input8bit[4*i + 1] = valBytes[1];
				input8bit[4*i + 2] = valBytes[2];
				input8bit[4*i + 3] = valBytes[3];
			}

			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, input8bit);
		}

		gl.bindTexture(gl.TEXTURE_2D, null);

		return texture;
	}

	return {
		// run code against a pre-allocated array
		run : function(ipt, code) {
			var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

			gl.shaderSource(
				fragmentShader,
				stdlib + code
			);

			gl.compileShader(fragmentShader);

			// Use this output to debug the shader
			// Keep in mind that WebGL GLSL is **much** stricter than e.g. OpenGL GLSL
			if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
				var LOC = code.split('\n');
				var dbgMsg = "ERROR: Could not build shader (fatal).\n\n------------------ KERNEL CODE DUMP ------------------\n"

				for (var nl = 0; nl < LOC.length; nl++)
					dbgMsg += nl + 1 + " > " + LOC[nl] + "\n";

				dbgMsg += "\n--------------------- ERROR  LOG ---------------------\n" + gl.getShaderInfoLog(fragmentShader)

				throw new Error(dbgMsg);
			}

			var program = gl.createProgram();

			gl.attachShader(program, vertexShader);
			gl.attachShader(program, fragmentShader);
			gl.linkProgram(program);

			if (!gl.getProgramParameter(program, gl.LINK_STATUS))
				throw new Error('turbojs: Failed to link GLSL program code.');

			var uTexture = gl.getUniformLocation(program, 'u_texture');
			var aPosition = gl.getAttribLocation(program, 'position');
			var aTexture = gl.getAttribLocation(program, 'texture');

			gl.useProgram(program);

			var size = Math.sqrt(ipt.data.length) / 4;
			var texture = createTexture(ipt.data, size);

			gl.viewport(0, 0, size, size);
			gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());

			// Types arrays speed this up tremendously.
			var nTexture = createTexture(new Float32Array(ipt.data.length), size);

			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, nTexture, 0);

			// Test for mobile bug MDN->WebGL_best_practices, bullet 7
			var frameBufferStatus = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE);

			if (!frameBufferStatus)
				throw new Error('turbojs: Error attaching float texture to framebuffer. Your device is probably incompatible. Error info: ' + frameBufferStatus.message);

			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.activeTexture(gl.TEXTURE0);
			gl.uniform1i(uTexture, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
			gl.enableVertexAttribArray(aTexture);
			gl.vertexAttribPointer(aTexture, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
			gl.enableVertexAttribArray(aPosition);
			gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
			gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

			if (~bandWidth) {
				gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, ipt.data);
			} else {
				var buffer = new Uint8Array(size * size * 4);
				var indx   = 0;
				gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
				for (var i = 0; i < buffer.length; i += 4) {
					ipt.data[indx] = fromIEEE754Single([buffer[i], buffer[i+1], buffer[i+2], buffer[i+3]]);
					indx++;
				}
			}

			return ipt.data.subarray(0, ipt.length);
		},
		alloc: function(sz) {
			// A sane limit for most GPUs out there.
			// JS falls apart before GLSL limits could ever be reached.
			if (sz > 16777216)
				throw new Error("turbojs: Whoops, the maximum array size is exceeded!");

			var ns = Math.pow(Math.pow(2, Math.ceil(Math.log(sz) / 1.386) - 1), 2);
			return {
				data : new Float32Array(ns * 16),
				length : sz
			};
		}
	};

}));

function toIEEE754(v, ebits, fbits) {

    var bias = (1 << (ebits - 1)) - 1;

    // Compute sign, exponent, fraction
    var s, e, f;
    if (isNaN(v)) {
        e = (1 << bias) - 1; f = 1; s = 0;
    }
    else if (v === Infinity || v === -Infinity) {
        e = (1 << bias) - 1; f = 0; s = (v < 0) ? 1 : 0;
    }
    else if (v === 0) {
        e = 0; f = 0; s = (1 / v === -Infinity) ? 1 : 0;
    }
    else {
        s = v < 0;
        v = Math.abs(v);

        if (v >= Math.pow(2, 1 - bias)) {
            var ln = Math.min(Math.floor(Math.log(v) / Math.LN2), bias);
            e = ln + bias;
            f = v * Math.pow(2, fbits - ln) - Math.pow(2, fbits);
        }
        else {
            e = 0;
            f = v / Math.pow(2, 1 - bias - fbits);
        }
    }

    // Pack sign, exponent, fraction
    var i, bits = [];
    for (i = fbits; i; i -= 1) { bits.push(f % 2 ? 1 : 0); f = Math.floor(f / 2); }
    for (i = ebits; i; i -= 1) { bits.push(e % 2 ? 1 : 0); e = Math.floor(e / 2); }
    bits.push(s ? 1 : 0);
    bits.reverse();
    var str = bits.join('');

    // Bits to bytes
    var bytes = [];
    while (str.length) {
        bytes.push(parseInt(str.substring(0, 8), 2));
        str = str.substring(8);
    }
    return bytes;
}

function fromIEEE754(bytes, ebits, fbits) {

    // Bytes to bits
    var bits = [];
    for (var i = bytes.length; i; i -= 1) {
        var byte = bytes[i - 1];
        for (var j = 8; j; j -= 1) {
            bits.push(byte % 2 ? 1 : 0); byte = byte >> 1;
        }
    }
    bits.reverse();
    var str = bits.join('');

    // Unpack sign, exponent, fraction
    var bias = (1 << (ebits - 1)) - 1;
    var s = parseInt(str.substring(0, 1), 2) ? -1 : 1;
    var e = parseInt(str.substring(1, 1 + ebits), 2);
    var f = parseInt(str.substring(1 + ebits), 2);

    // Produce number
    if (e === (1 << ebits) - 1) {
        return f !== 0 ? NaN : s * Infinity;
    }
    else if (e > 0) {
        return s * Math.pow(2, e - bias) * (1 + f / Math.pow(2, fbits));
    }
    else if (f !== 0) {
        return s * Math.pow(2, -(bias-1)) * (f / Math.pow(2, fbits));
    }
    else {
        return s * 0;
    }
}

function fromIEEE754Double(b) { return fromIEEE754(b, 11, 52); }
function   toIEEE754Double(v) { return   toIEEE754(v, 11, 52); }
function fromIEEE754Single(b) { return fromIEEE754(b,  8, 23); }
function   toIEEE754Single(v) { return   toIEEE754(v,  8, 23); }