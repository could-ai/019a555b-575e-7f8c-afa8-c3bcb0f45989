
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";

// CORS headers for cross-origin requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle preflight OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create a Supabase client with the service role key to perform admin-level operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Extract registration data from the request body
    const { username, email_or_phone, password, captchaToken } = await req.json();

    // --- 1. Verify Captcha Token (TODO) ---
    // In a production environment, you would verify the captchaToken with a service like Google reCAPTCHA.
    // This step is crucial to prevent bots from spamming your registration endpoint.
    // For this example, we will simulate a successful verification.
    if (!captchaToken) {
        // This check is a placeholder for actual verification logic.
        // return new Response(JSON.stringify({ error: "CAPTCHA verification failed." }), {
        //   headers: { ...corsHeaders, "Content-Type": "application/json" },
        //   status: 400,
        // });
    }

    // --- 2. Validate Inputs ---
    if (!username || !email_or_phone || !password) {
      return new Response(JSON.stringify({ error: "Missing required fields." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters long." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    // Basic regex to distinguish between email and phone
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_or_phone);
    const isPhone = /^\+?[1-9]\d{1,14}$/.test(email_or_phone);
    if (!isEmail && !isPhone) {
        return new Response(JSON.stringify({ error: "Invalid email or phone number format." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }

    // --- 3. Check for Uniqueness ---
    // Check if the username, email, or phone already exists in the public.users table.
    const { data: existingUser, error: existingUserError } = await supabaseAdmin
      .from("users")
      .select("username, email, phone")
      .or(`username.eq.${username},email.eq.${email_or_phone},phone.eq.${email_or_phone}`);

    if (existingUserError) {
        console.error("Error checking for existing user:", existingUserError);
        return new Response(JSON.stringify({ error: "Database error while checking user uniqueness." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
        });
    }

    if (existingUser && existingUser.length > 0) {
      return new Response(JSON.stringify({ error: "Username, email, or phone already exists." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409, // 409 Conflict
      });
    }

    // --- 4, 5, 6. Hash Password, Create User, and Send OTP ---
    // Use Supabase Auth to handle user creation. It automatically hashes the password,
    // creates the user in the auth.users table, and sends a verification OTP.
    const authData = {
        password: password,
        ...(isEmail ? { email: email_or_phone } : { phone: email_or_phone }),
    };

    const { data: authUser, error: signUpError } = await supabaseAdmin.auth.admin.createUser(authData);

    if (signUpError) {
        console.error("Supabase sign up error:", signUpError);
        return new Response(JSON.stringify({ error: signUpError.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }
    
    if (!authUser || !authUser.user) {
        return new Response(JSON.stringify({ error: "Failed to create user." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
        });
    }

    // Now, insert the public profile into your `public.users` table
    const { error: insertError } = await supabaseAdmin
    .from("users")
    .insert({
        id: authUser.user.id,
        username: username,
        ...(isEmail ? { email: email_or_phone } : { phone: email_or_phone }),
    });

    if (insertError) {
        console.error("Error inserting into public.users:", insertError);
        // If this fails, you should ideally delete the user from auth.users to keep data consistent
        await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
        return new Response(JSON.stringify({ error: "Failed to save user profile." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
        });
    }


    // --- 7. Return Success ---
    // Respond to the client that the user has been created and an OTP has been sent.
    return new Response(JSON.stringify({ message: "Registration successful. Please check your email or phone for an OTP to verify your account." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("Unhandled error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
