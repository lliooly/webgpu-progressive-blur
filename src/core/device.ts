import type { WebGPUCapability } from './types';

export type ProgressiveBlurErrorCode =
  | 'webgpu-unavailable'
  | 'adapter-unavailable'
  | 'device-unavailable'
  | 'invalid-canvas';

export class ProgressiveBlurError extends Error {
  readonly code: ProgressiveBlurErrorCode;

  constructor(code: ProgressiveBlurErrorCode, message: string) {
    super(message);
    this.name = 'ProgressiveBlurError';
    this.code = code;
  }
}

export function getWebGPUCapability(): WebGPUCapability {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return {
      supported: false,
      reason: 'This environment does not expose navigator.gpu.',
    };
  }

  return { supported: true };
}

export interface DeviceRequestOptions {
  device?: GPUDevice;
  adapter?: GPUAdapter;
  powerPreference?: GPUPowerPreference;
}

export interface DeviceRequestResult {
  device: GPUDevice;
  adapter?: GPUAdapter;
}

export async function requestWebGPUDevice(
  options: DeviceRequestOptions = {},
): Promise<DeviceRequestResult> {
  if (options.device) {
    return { device: options.device, adapter: options.adapter };
  }

  const capability = getWebGPUCapability();
  if (!capability.supported) {
    throw new ProgressiveBlurError(
      'webgpu-unavailable',
      capability.reason ?? 'WebGPU is unavailable in this environment.',
    );
  }

  const adapter =
    options.adapter ??
    (await navigator.gpu.requestAdapter({
      powerPreference: options.powerPreference ?? 'high-performance',
    }));

  if (!adapter) {
    throw new ProgressiveBlurError(
      'adapter-unavailable',
      'WebGPU is present, but no compatible adapter could be selected.',
    );
  }

  try {
    return { adapter, device: await adapter.requestDevice() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProgressiveBlurError(
      'device-unavailable',
      `WebGPU device creation failed: ${message}`,
    );
  }
}

