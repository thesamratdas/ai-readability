package com.example.repo

/**
 * A user record fetched from storage.
 */
data class User(val id: String, val email: String, val active: Boolean = true)

/**
 * Loads and caches User records.
 */
class UserRepository(private val db: Database) {

    private val cache = mutableMapOf<String, User>()

    /**
     * Returns the user with the given id, hitting the cache first.
     */
    fun findById(id: String): User? {
        cache[id]?.let { return it }
        val user = db.query(id)
        if (user != null) cache[id] = user
        return user
    }

    fun invalidate(id: String) {
        cache.remove(id)
    }

    private fun logAccess(id: String) {
        println("accessed $id")
    }
}
