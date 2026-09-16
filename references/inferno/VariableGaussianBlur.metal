//
//  VariableGaussianBlur.metal
//  Inferno
//
//  Created by Dale Price on 11/28/23.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;


/**
 Formula of a gaussian function for single axis as described by
 https://en.wikipedia.org/wiki/Gaussian_blur .

 Creates a "bell curve" shape which we'll use for the weight of each sample when averaging.

 - Parameters:
    - distance: The distance from the origin along the current axis.
    - sigma: The desired standard deviation of the bell curve.
 */
inline half gaussian(half distance, half sigma) {
    // Calculate the exponent of the Gaussian equation.
    const half gaussianExponent = -(distance * distance) / (2.0h * sigma * sigma);
    
    // Calculate and return the entire Gaussian equation.
    return (1.0h / (2.0h * M_PI_H * sigma * sigma)) * exp(gaussianExponent);
}

/**
 Calculate pixel color using the weighted average of multiple samples along the X axis.

 - Parameters:
    - position: The coordinates of the current pixel.
    - boundingRect: The bounding rect of the view.
    - layer: The SwiftUI layer we're reading from.
    - normalizeEdges: If true, avoid sampling areas outside of the bounding rect for the blur.
    - radius: The desired blur radius.
    - axisMultiplier: A vector defining which axis to sample along. Should be `(1, 0)` for X, or `(0, 1)` for Y.
    - maxSamples: The maximum number of samples to read in each direction from the current pixel.
        Texture sampling is expensive, so instead of sampling every pixel, we use a lower count spread out
        across the radius.
 */
half4 gaussianBlur1D(float2 position, float4 boundingRect, SwiftUI::Layer layer, bool normalizeEdges, half radius, half2 axisMultiplier, half maxSamples) {
    // Calculate how far apart the samples should be: either 1 pixel or the desired radius divided by the maximum number of samples, whichever is farther.
    const half interval = max(1.0h, radius / maxSamples);
    
    // Take the first sample.
    // Calculate the weight for this sample in the weighted average using the Gaussian equation.
    const half weight = gaussian(0.0h, radius / 3.0h);
    // Sample the pixel at the current position and multiply its color by the weight, to use in the weighted average.
    // Each sample's color will be combined into the `weightedColorSum` variable (the numerator for the weighted average).
    half4 weightedColorSum = layer.sample(position) * weight;
    // The `totalWeight` variable will keep track of the sum of all weights (the denominator for the weighted average). Start with the weight of the current sample.
    half totalWeight = weight;
    
    // If the radius is high enough to take more samples, take them.
    if(interval <= radius) {
        
        // Set up a bounding box that all samples must be within. If we are normalizing the edges, ths is the view's bounding box. Otherwise, it is infinitely large.
        // Later, we will reject any samples outside of this bounding box.
        const float2 minSamplePos = normalizeEdges ? float2(boundingRect[0], boundingRect[1]) : float2(-HUGE_VALF);
        const float2 maxSamplePos = normalizeEdges ? float2(boundingRect[0] + boundingRect[2], boundingRect[1] + boundingRect[3]) : float2(HUGE_VALF);
        
        // Take a sample every `interval` up to and including the desired blur radius.
        for (half distance = interval; distance <= radius; distance += interval) {
            // Calculate the sample offset as a 2D vector.
            const half2 offsetDistance = axisMultiplier * distance;
            
            // Calculate the sample's weight using the Gaussian equation. For the sigma value, we use half the blur radius so that the resulting bell curve fits nicely within the radius.
            const half weight = gaussian(distance, radius / 3.0h);
            
            // Take two samples along the axis, one in the positive direction and one negative, multiply by weight, and add to the sum. Add weight to the total.
            const half2 positiveOffsetSamplePos = half2(position) + offsetDistance;
            const half2 negativeOffsetSamplePos = half2(position) - offsetDistance;
            // Only take and count each sample if it is within the bounding box that we set earlier.
            if(!any(float2(positiveOffsetSamplePos) > maxSamplePos)) {
                weightedColorSum += layer.sample(float2(positiveOffsetSamplePos)) * weight;
                totalWeight += weight;
            }
            if(!any(float2(negativeOffsetSamplePos) < minSamplePos)) {
                weightedColorSum += layer.sample(float2(negativeOffsetSamplePos)) * weight;
                totalWeight += weight;
            }
        }
    }
    
    // Return the weighted average color of the samples by dividing the weighted sum of the colors by the sum of the weights.
    return weightedColorSum / totalWeight;
}

/**
 Variable blur effect along the specified axis that samples from a texture to determine the blur radius
 multiplier at each pixel.

 This shader requires two passes, one along the X axis and one along the Y.

 The two-pass approach is better for performance as it scales linearly rather than exponentially with
 `pixel count * radius * sample count`, but can result in "streak" artifacts where blurred areas
 meet unblurred areas.

 - Parameters:
    - position: The coordinates of the current pixel in user space.
    - layer: The SwiftUI layer we're applying the blur to.
    - boundingRect: The bounding rectangle of the SwiftUI view in user space.
    - radius: The desired maximum blur radius for areas of the mask that are fully opaque.
    - maxSamples: The maximum number of samples to read _in each direction_ from the current pixel.
        Reducing this value increases performance but results in banding in the resulting blur.
    - mask: The texture to sample alpha values from to determine the blur radius at each pixel.
    - vertical: Specifies to blur along the Y axis. Because SwiftUI can't pass booleans to a shader,
        `0.0` is treated as `false` (i.e. blur the X axis), and any other value is treated as `true`
        (i.e. blur the Y axis).
    - normalizeEdges: If true (1.0), avoids blurring the edges of the view's bounding box.
 */
[[ stitchable ]] half4 variableBlur(float2 position, SwiftUI::Layer layer, float4 boundingRect, float radius, float maxSamples, texture2d<half> mask, float vertical, float normalizeEdges) {
    // Calculate the position in UV space within the bounding rect (0 to 1).
    const float2 uv = float2(position.x / boundingRect[2], position.y / boundingRect[3]);
    
    // If we are normalizing edges, return clear for any pixel outside of the bounding box.
    if(normalizeEdges == 1.0 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) {
        return half4(0.0h);
    }

    // Sample the alpha value of the mask at the current UV position.
    const half maskAlpha = mask.sample(metal::sampler(metal::filter::linear), uv).a;
    
    // Determine the blur radius at this pixel by multiplying the alpha value from the mask with the radius parameter.
    const half pixelRadius = maskAlpha * half(radius);
    
    // If the resulting radius is 1 pixel or greater…
    if(pixelRadius >= 1.0h) {
        // Set the "axis multiplier" value that tells the blur function whether to sample along the X or Y axis.
        const half2 axisMultiplier = vertical == 0.0 ? half2(1, 0) : half2(0, 1);
        
        // Return the blurred color.
        return gaussianBlur1D(position, boundingRect, layer, normalizeEdges == 1.0, pixelRadius, axisMultiplier, maxSamples);
    } else {
        // If the blur radius is less than 1 pixel, return the current pixel's color as-is.
        return layer.sample(position);
    }
}
