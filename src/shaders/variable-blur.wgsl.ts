/**
 * Separable variable Gaussian blur.
 *
 * The public API expresses radius as Gaussian sigma. The renderer passes the
 * equivalent 3-sigma support radius to this shader, matching Inferno's Metal
 * implementation.
 */
export const variableBlurWgsl = /* wgsl */ `
const MAX_SAMPLES: u32 = 64u;
const PI: f32 = 3.141592653589793;

struct BlurParams {
  size: vec2<f32>,
  texelSize: vec2<f32>,
  supportRadius: f32,
  maxSamples: f32,
  axis: f32,
  mode: f32,
  gradientStart: f32,
  gradientEnd: f32,
  gradientDirection: f32,
  normalizeEdges: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> params: BlurParams;
@group(0) @binding(3) var maskTexture: texture_2d<f32>;
@group(0) @binding(4) var maskSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );

  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

fn pixelPositionToUv(pixelPosition: vec2<f32>) -> vec2<f32> {
  return pixelPosition * params.texelSize;
}

fn inBoundingRect(pixelPosition: vec2<f32>) -> bool {
  return pixelPosition.x >= 0.0 &&
    pixelPosition.x <= params.size.x &&
    pixelPosition.y >= 0.0 &&
    pixelPosition.y <= params.size.y;
}

// SwiftUI's Layer can be sampled outside its own layer. The WebGPU equivalent
// is a transparent layer exterior; normalizeEdges decides whether that sample
// is rejected or contributes transparent weight.
fn sampleSourceAtPixel(pixelPosition: vec2<f32>) -> vec4<f32> {
  if (!inBoundingRect(pixelPosition)) {
    return vec4<f32>(0.0);
  }
  return textureSampleLevel(
    sourceTexture,
    sourceSampler,
    pixelPositionToUv(pixelPosition),
    0.0,
  );
}

fn gaussian(distance: f32, sigma: f32) -> f32 {
  let safeSigma = max(sigma, 0.0001);
  let exponent = -(distance * distance) / (2.0 * safeSigma * safeSigma);
  return (1.0 / (2.0 * PI * safeSigma * safeSigma)) * exp(exponent);
}

fn maskStrength(uv: vec2<f32>) -> f32 {
  if (params.mode < 0.5) {
    return textureSampleLevel(maskTexture, maskSampler, uv, 0.0).a;
  }

  let range = max(abs(params.gradientEnd - params.gradientStart), 0.0001);
  let progress = clamp((uv.y - params.gradientStart) / range, 0.0, 1.0);
  if (params.gradientDirection < 0.5) {
    return 1.0 - progress;
  }
  return progress;
}

fn blur1D(position: vec2<f32>, radius: f32, axis: vec2<f32>) -> vec4<f32> {
  let interval = max(1.0, radius / max(params.maxSamples, 1.0));
  let sigma = radius / 3.0;
  let centerWeight = gaussian(0.0, sigma);
  var weightedColor = sampleSourceAtPixel(position) * centerWeight;
  var totalWeight = centerWeight;

  if (interval <= radius) {
    for (var index: u32 = 1u; index <= MAX_SAMPLES; index = index + 1u) {
      let distance = f32(index) * interval;
      if (distance > radius) {
        break;
      }

      let weight = gaussian(distance, sigma);
      let offset = axis * distance;
      let positivePosition = position + offset;
      let negativePosition = position - offset;

      if (params.normalizeEdges < 0.5 || inBoundingRect(positivePosition)) {
        weightedColor = weightedColor + sampleSourceAtPixel(positivePosition) * weight;
        totalWeight = totalWeight + weight;
      }
      if (params.normalizeEdges < 0.5 || inBoundingRect(negativePosition)) {
        weightedColor = weightedColor + sampleSourceAtPixel(negativePosition) * weight;
        totalWeight = totalWeight + weight;
      }
    }
  }

  return weightedColor / max(totalWeight, 0.0001);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let pixelPosition = input.position.xy;
  let uv = pixelPositionToUv(pixelPosition);
  let strength = clamp(maskStrength(uv), 0.0, 1.0);
  let radius = strength * params.supportRadius;

  if (radius < 1.0) {
    return sampleSourceAtPixel(pixelPosition);
  }

  let axis = select(
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    params.axis >= 0.5,
  );
  return blur1D(pixelPosition, radius, axis);
}
`;
