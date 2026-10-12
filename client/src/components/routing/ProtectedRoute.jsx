import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import Spinner from "../ui/Spinner";

/*
 * Sends an unauthenticated visitor to the sign-in screen.
 *
 * It deliberately does not hand over where they were. Login used to resume that
 * deep link, which meant a session expiring on /profile dumped you straight back
 * on /profile after signing in — reading as the login being ignored rather than
 * as the app remembering. There is nowhere in the app that must be resumed to
 * finish a task, so sign-in always starts at the chat list.
 */
export default function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <Spinner fullPage label="Restoring your session" />;
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}
