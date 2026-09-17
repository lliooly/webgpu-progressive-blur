"use client";

import {
  useEffect,
  useRef,
  type HTMLAttributes,
  type CSSProperties,
} from "react";
import type { BlurPlacement, BlurPreset } from "webgpu-progressive-blur/dom";
import { mountProgressiveBlur } from "./lifecycle";
import { presetLayout } from "./layout";

export interface ProgressiveBlurProps extends HTMLAttributes<HTMLDivElement> {
  preset?: BlurPreset;
  placement?: BlurPlacement;
  radius?: number;
  transition?: number;
  maxSamples?: number;
  /** Change this value after the background content changes to recapture it. */
  refreshKey?: string | number;
}

export function ProgressiveBlur({
  preset = "panel",
  placement,
  radius = 24,
  transition = 48,
  maxSamples = 32,
  refreshKey,
  children,
  style,
  ...props
}: ProgressiveBlurProps) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    return mountProgressiveBlur(element, {
      preset,
      placement,
      radius,
      transition,
      maxSamples,
    });
  }, [preset, placement, radius, transition, maxSamples, refreshKey]);

  return (
    <div
      {...props}
      ref={target}
      style={{
        ...(presetLayout(preset, placement) as CSSProperties),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
