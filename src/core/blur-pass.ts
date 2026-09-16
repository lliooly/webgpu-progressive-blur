import { variableBlurWgsl } from '../shaders/variable-blur.wgsl.js';
import { BLUR_UNIFORM_BYTE_SIZE } from './blur-params.js';

export function createBlurShaderModule(device: GPUDevice): GPUShaderModule {
  return device.createShaderModule({ code: variableBlurWgsl });
}

export function createBlurPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  shaderModule = createBlurShaderModule(device),
): GPURenderPipeline {
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  });
}

export interface BlurPassResources {
  device: GPUDevice;
  commandEncoder: GPUCommandEncoder;
  sourceTexture: GPUTexture;
  targetView: GPUTextureView;
  pipeline: GPURenderPipeline;
  maskTexture: GPUTexture;
  sampler: GPUSampler;
  maskSampler: GPUSampler;
  uniformBuffer: GPUBuffer;
  uniformValues: Float32Array;
}

/** Encodes one Inferno-compatible separable blur pass. */
export function encodeBlurPass(resources: BlurPassResources): void {
  const {
    device,
    commandEncoder,
    sourceTexture,
    targetView,
    pipeline,
    maskTexture,
    sampler,
    maskSampler,
    uniformBuffer,
    uniformValues,
  } = resources;

  if (uniformValues.byteLength !== BLUR_UNIFORM_BYTE_SIZE) {
    throw new RangeError(`Blur uniforms must be ${BLUR_UNIFORM_BYTE_SIZE} bytes.`);
  }
  device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sourceTexture.createView() },
      { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: uniformBuffer } },
      { binding: 3, resource: maskTexture.createView() },
      { binding: 4, resource: maskSampler },
    ],
  });

  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
}
