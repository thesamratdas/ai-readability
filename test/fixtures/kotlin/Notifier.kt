package com.example.notify

/**
 * Sends notifications through a pluggable channel.
 */
interface NotificationChannel {
    fun send(message: String): Boolean
}

object EmailChannel : NotificationChannel {
    override fun send(message: String): Boolean {
        println("emailing: $message")
        return true
    }
}

fun buildGreeting(name: String): String {
    return "Hello, $name!"
}
