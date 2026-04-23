import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS configuration - allow all origins for preview functionality
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_EMAIL = 'exambo116@gmail.com';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Server-side authentication check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
      return new Response(
        JSON.stringify({ error: 'Unauthorized', page_numbers: [], batch_results: [] }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user is authenticated
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      console.error('Authentication failed:', authError?.message ?? 'No user found');
      return new Response(
        JSON.stringify({ error: 'Unauthorized', page_numbers: [], batch_results: [] }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Server-side email authorization check
    if (user.email !== ALLOWED_EMAIL) {
      console.error('Access denied for email:', user.email);
      return new Response(
        JSON.stringify({ error: 'Forbidden', page_numbers: [], batch_results: [] }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Authenticated user:', user.email);
    const body = await req.json();
    
    // Support both single image (legacy) and batch mode
    const images: string[] = body?.images || (body?.imageBase64 ? [body.imageBase64] : []);
    const isBatchMode = Array.isArray(body?.images) && body.images.length > 1;

    if (images.length === 0) {
      console.error('Invalid request: missing image data');
      return new Response(
        JSON.stringify({ error: 'Invalid request', page_numbers: [], batch_results: [] }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate each image
    const MAX_SIZE = 10 * 1024 * 1024;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img || typeof img !== 'string') {
        console.error(`Invalid image at index ${i}`);
        return new Response(
          JSON.stringify({ error: `Invalid image at index ${i}`, page_numbers: [], batch_results: [] }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (img.length > MAX_SIZE) {
        console.error(`Image ${i} too large:`, img.length, 'bytes');
        return new Response(
          JSON.stringify({ error: `Image ${i} too large`, page_numbers: [], batch_results: [] }),
          { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Use personal Gemini API key
    const GEMINI_API_KEY = Deno.env.get('VITE_GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      console.error('VITE_GEMINI_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'Gemini API key not configured. Please add VITE_GEMINI_API_KEY to project secrets.', page_numbers: [], batch_results: [] }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Model configuration with fallback
    const PRIMARY_MODEL = 'gemini-2.5-flash';
    const FALLBACK_MODEL = 'gemini-2.0-flash';

    // Build the prompt based on batch or single mode
    const imageParts = images.map((img, idx) => ({
      inlineData: {
        mimeType: 'image/jpeg',
        data: img
      }
    }));

    let prompt: string;
    if (isBatchMode) {
      prompt = `You are a precise page number detector for book images. I will provide ${images.length} book page images. Analyze each image and identify page numbers visible on the pages.

INSTRUCTIONS:
1. Analyze each image in order (Image 1, Image 2, etc.)
2. Look for page numbers - they are typically at the bottom or top corners
3. An open book usually shows two pages side by side (left and right)
4. Return ONLY valid JSON, nothing else

RESPONSE FORMAT (JSON only):
{"results": [[page_nums_image1], [page_nums_image2], ...]}

Examples for ${images.length} images:
- If Image 1 shows pages 12-13, Image 2 shows 14-15: {"results": [[12, 13], [14, 15]]}
- If Image 1 shows page 100, Image 2 has no numbers: {"results": [[100], []]}
- Always return exactly ${images.length} arrays in the results array

Analyze all ${images.length} images now:`;
    } else {
      prompt = `You are a precise page number detector for book images. Analyze this image of an open book and identify page numbers visible on BOTH the Left and Right pages.

INSTRUCTIONS:
1. Look for page numbers - they are typically at the bottom or top corners of each page
2. An open book usually shows two pages side by side
3. Page numbers may appear in headers, footers, or margins
4. Return ONLY valid JSON, nothing else

RESPONSE FORMAT (JSON only):
{"page_numbers": [left_page, right_page]}

Examples:
- If you see pages 455 and 456: {"page_numbers": [455, 456]}
- If only one page visible with number 123: {"page_numbers": [123]}
- If no page numbers found: {"page_numbers": []}`;
    }

    // Build content parts: text prompt first, then all images
    const contentParts: any[] = [{ text: prompt }, ...imageParts];

    // Helper function to call Gemini API
    const callGeminiAPI = async (modelName: string) => {
      console.log(`Trying model: ${modelName}...`);
      return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: contentParts
            }
          ],
          generationConfig: {
            maxOutputTokens: 500,
            temperature: 0.1
          }
        }),
      });
    };

    // Try primary model first, fallback if 404
    let response = await callGeminiAPI(PRIMARY_MODEL);
    let usedModel = PRIMARY_MODEL;
    
    if (response.status === 404) {
      console.log(`Model ${PRIMARY_MODEL} not found (404), falling back to ${FALLBACK_MODEL}...`);
      response = await callGeminiAPI(FALLBACK_MODEL);
      usedModel = FALLBACK_MODEL;
    }

    console.log(`Processing ${images.length} image(s) using ${usedModel}...`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error - Status:', response.status, 'Details:', errorText.substring(0, 200));
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Gemini API rate limit exceeded. Please try again.', page_numbers: [], batch_results: [] }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 400) {
        return new Response(
          JSON.stringify({ error: 'Invalid Gemini API key or request.', page_numbers: [], batch_results: [] }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Gemini API processing failed', page_numbers: [], batch_results: [] }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log('Gemini API Response:', content);

    // Parse the JSON response
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    if (isBatchMode) {
      // Parse batch results
      let batchResults: number[][] = [];
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed.results)) {
          batchResults = parsed.results.map((arr: any) => {
            if (Array.isArray(arr)) {
              return arr
                .filter((n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0)
                .sort((a: number, b: number) => a - b);
            }
            return [];
          });
        }
      } catch (parseError) {
        console.error('Failed to parse batch response:', parseError);
        // Return empty arrays for each image if parsing fails
        batchResults = images.map(() => []);
      }

      // Ensure we have the right number of results
      while (batchResults.length < images.length) {
        batchResults.push([]);
      }

      console.log('Batch results:', batchResults);

      return new Response(
        JSON.stringify({ batch_results: batchResults, page_numbers: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Single image mode (legacy compatibility)
      let pageNumbers: number[] = [];
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed.page_numbers)) {
          pageNumbers = parsed.page_numbers
            .filter((n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0)
            .sort((a: number, b: number) => a - b);
        }
      } catch (parseError) {
        console.error('Failed to parse AI response:', parseError);
        const matches = content.match(/\d+/g);
        if (matches) {
          pageNumbers = matches
            .map((n: string) => parseInt(n, 10))
            .filter((n: number) => n > 0 && n < 10000)
            .sort((a: number, b: number) => a - b);
        }
      }

      console.log('Detected page numbers:', pageNumbers);

      return new Response(
        JSON.stringify({ page_numbers: pageNumbers, batch_results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('Error in detect-page function:', error instanceof Error ? error.message : 'Unknown error');
    return new Response(
      JSON.stringify({ error: 'Processing failed', page_numbers: [], batch_results: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
