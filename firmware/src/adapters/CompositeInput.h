#pragma once

#include "ports/IInput.h"

namespace feedme2::adapters {

// Merges two input sources (knob + touch) into one IInput. Round-robin
// polling: the source asked first alternates after each delivered event, so
// a chatty source cannot starve the other. Each poll() returns at most one
// event; the caller loops until None to drain. isHeld() is the OR of both,
// which is what the long-press arc needs regardless of which surface is held.
template <typename A, typename B>
class CompositeInput final : public ports::IInput {
public:
    CompositeInput(A& a, B& b) : a_(a), b_(b) {}

    application::InputEvent poll() override {
        using application::InputEvent;
        if (preferA_) {
            const InputEvent e = a_.poll();
            if (e != InputEvent::None) { preferA_ = false; return e; }
            return b_.poll();
        }
        const InputEvent e = b_.poll();
        if (e != InputEvent::None) { preferA_ = true; return e; }
        return a_.poll();
    }

    bool isHeld() const override { return a_.isHeld() || b_.isHeld(); }

private:
    A& a_;
    B& b_;
    bool preferA_ = true;
};

}  // namespace feedme2::adapters
