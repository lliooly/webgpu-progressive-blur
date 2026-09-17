'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ForwardedRef,
  type HTMLAttributes,
} from 'react';
import type { BlurPlacement, BlurPreset } from 'webgpu-progressive-blur/dom';
import {
  mountProgressiveBlur,
  type BlurMountHandle,
} from './lifecycle';
import { presetLayout } from './layout';

export interface ProgressiveBlurProps extends HTMLAttributes<HTMLDivElement> {
  preset?: BlurPreset;
  placement?: BlurPlacement;
  radius?: number;
  transition?: number;
  maxSamples?: number;
  /** Change this value after the background content changes to recapture it. */
  refreshKey?: string | number;
}

function setRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

export const ProgressiveBlur = forwardRef<HTMLDivElement, ProgressiveBlurProps>(
  function ProgressiveBlur(
    {
      preset = 'panel',
      placement,
      radius = 24,
      transition = 48,
      maxSamples = 32,
      refreshKey,
      children,
      style,
      ...props
    },
    forwardedRef,
  ) {
    const target = useRef<HTMLDivElement | null>(null);
    const mount = useRef<BlurMountHandle | null>(null);
    const previousRefreshKey = useRef<string | number | undefined>(refreshKey);
    const assignTarget = useCallback(
      (element: HTMLDivElement | null) => {
        target.current = element;
        setRef(forwardedRef, element);
      },
      [forwardedRef],
    );

    useEffect(() => {
      const element = target.current;
      if (!element) return undefined;
      const nextMount = mountProgressiveBlur(element, {
        preset,
        placement,
        radius,
        transition,
        maxSamples,
      });
      mount.current = nextMount;
      return () => {
        if (mount.current === nextMount) mount.current = null;
        nextMount.destroy();
      };
    }, [preset, placement, radius, transition, maxSamples]);

    useEffect(() => {
      if (previousRefreshKey.current === refreshKey) return;
      previousRefreshKey.current = refreshKey;
      void mount.current?.refresh();
    }, [refreshKey]);

    return (
      <div
        {...props}
        ref={assignTarget}
        style={{
          ...(presetLayout(preset, placement) as CSSProperties),
          ...style,
        }}
      >
        {children}
      </div>
    );
  },
);

ProgressiveBlur.displayName = 'ProgressiveBlur';
