/**
 * Separable variable Gaussian blur.
 *
 * The public API expresses radius as sigma. The renderer passes the equivalent
 * 3-sigma support radius to this shader, matching Inferno's Metal shader.
 */
export const variableBlurWgsl = /* wgsl */ `
const MAX_SAMPLES: u32 = 64u;

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
  @location(0) uv: vec2<f32>,
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
  let position = positions[vertexIndex];

  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.uv = vec2<f32>(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  return output;
}

fn gaussian(distance: f32, sigma: f32) -> f32 {
  let safeSigma = max(sigma, 0.0001);
  return exp(-(distance * distance) / (2.0 * safeSigma * safeSigma));
}

fn inBounds(uv: vec2<f32>) -> bool {
  return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

fn blurStrength(uv: vec2<f32>) -> f32 {
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

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let strength = clamp(blurStrength(input.uv), 0.0, 1.0);
  let radius = strength * params.supportRadius;

  if (radius < 1.0) {
    let sourceColor = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
    return sourceColor;
  }

  let sigma = radius / 3.0;
  let centerWeight = gaussian(0.0, sigma);
  var weightedColor = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0) * centerWeight;
  var totalWeight = centerWeight;
  let interval = max(1.0, radius / max(params.maxSamples, 1.0));
  let axis = select(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0), params.axis >= 0.5);

  for (var index: u32 = 1u; index <= MAX_SAMPLES; index = index + 1u) {
    let distance = f32(index) * interval;
    if (distance > radius) {
      break;
    }

    let weight = gaussian(distance, sigma);
    let offset = axis * distance * params.texelSize;
    let positiveUv = input.uv + offset;
    let negativeUv = input.uv - offset;

    if (params.normalizeEdges < 0.5 || inBounds(positiveUv)) {
      weightedColor = weightedColor + textureSampleLevel(sourceTexture, sourceSampler, positiveUv, 0.0) * weight;
      totalWeight = totalWeight + weight;
    }
    if (params.normalizeEdges < 0.5 || inBounds(negativeUv)) {
      weightedColor = weightedColor + textureSampleLevel(sourceTexture, sourceSampler, negativeUv, 0.0) * weight;
      totalWeight = totalWeight + weight;
    }
  }

  let blurredColor = weightedColor / max(totalWeight, 0.0001);
  return blurredColor;
}
`;
