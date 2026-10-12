import { useCallback, useEffect, useState } from 'react';
import { getRoom } from '../services/rooms.service';

/**
 * One room, with its members.
 *
 * `reload` is returned alongside the room because membership changes are pushed
 * over the socket rather than applied optimistically: an admin acting on somebody
 * else has to see the result of a change they made in another browser, and the
 * honest way to get it is to ask the server again rather than to mirror the
 * mutation locally and hope the two agree.
 *
 * @param {string} roomId
 */
export default function useRoom(roomId) {
  const [room, setRoom] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const value = await getRoom(roomId);
      setRoom(value);
      setError('');
      return value;
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load this room.');
      return null;
    }
  }, [roomId]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError('');
    getRoom(roomId)
      .then((value) => active && setRoom(value))
      .catch((err) => active && setError(err.response?.data?.message || 'Could not load this room.'))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [roomId]);

  return { room, isLoading, error, reload };
}