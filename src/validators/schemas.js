import { z } from "zod";

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Mínimo 8 caracteres"),
  display_name: z.string().min(2),
  favorite_base: z.enum(["RON","TEQUILA","WHISKY","GIN","VODKA","BRANDY","NA"])
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});
